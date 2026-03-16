//go:build js && wasm

package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha1"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

// TestIntegrationPatch runs the full patching pipeline with real patch files
// and validates SHA1 checksums of the patched binaries.
//
// Requires the firmware zip to be present at testdata/kobo-update-4.45.23646.zip
// (or the path set via FIRMWARE_ZIP env var). Run test-integration.sh to download
// the firmware and execute this test.
func TestIntegrationPatch(t *testing.T) {
	firmwarePath := os.Getenv("FIRMWARE_ZIP")
	if firmwarePath == "" {
		firmwarePath = "testdata/kobo-update-4.45.23646.zip"
	}

	firmwareZip, err := os.ReadFile(firmwarePath)
	if err != nil {
		t.Skipf("firmware zip not available at %s (run test-integration.sh to download): %v", firmwarePath, err)
	}

	// Read patch files from the patches zip.
	patchesZipPath := "../web/public/patches/patches_4.4523646.zip"
	patchesZip, err := os.ReadFile(patchesZipPath)
	if err != nil {
		t.Fatalf("could not read patches zip: %v", err)
	}

	patchFiles, err := extractPatchFiles(patchesZip)
	if err != nil {
		t.Fatalf("could not extract patch files: %v", err)
	}

	// Config: all patches at their defaults, with one override enabled.
	configYAML := `
version: 4.45.23646
in: unused
out: unused
log: unused

patches:
  src/nickel.yaml: usr/local/Kobo/nickel
  src/nickel_custom.yaml: usr/local/Kobo/nickel
  src/libadobe.so.yaml: usr/local/Kobo/libadobe.so
  src/libnickel.so.1.0.0.yaml: usr/local/Kobo/libnickel.so.1.0.0
  src/librmsdk.so.1.0.0.yaml: usr/local/Kobo/librmsdk.so.1.0.0
  src/cloud_sync.yaml: usr/local/Kobo/libnickel.so.1.0.0

overrides:
  src/nickel.yaml:
    "Remove footer (row3) on new home screen": yes
`

	var logMessages []string
	progress := func(msg string) {
		logMessages = append(logMessages, msg)
	}

	result, err := patchFirmware([]byte(configYAML), firmwareZip, patchFiles, progress)
	if err != nil {
		t.Fatalf("patchFirmware failed: %v", err)
	}

	if len(result.tgzBytes) == 0 {
		t.Fatal("patchFirmware returned empty tgz")
	}

	// Expected SHA1 checksums for Kobo Libra Color, firmware 4.45.23646,
	// with only "Remove footer (row3) on new home screen" enabled.
	expectedSHA1 := map[string]string{
		"usr/local/Kobo/libnickel.so.1.0.0": "ef64782895a47ac85f0829f06fffa4816d23512d",
		"usr/local/Kobo/nickel":              "80a607bac515457a6864be8be831df631a01005c",
		"usr/local/Kobo/libadobe.so":         "02dc99c71c4fef75401cd49ddc2e63f928a126e1",
		"usr/local/Kobo/librmsdk.so.1.0.0":   "e3819260c9fc539a53db47e9d3fe600ec11633d5",
	}

	// Extract the output tgz and check SHA1 of each patched binary.
	actualSHA1, err := extractTgzSHA1(result.tgzBytes)
	if err != nil {
		t.Fatalf("could not extract output tgz: %v", err)
	}

	for name, expected := range expectedSHA1 {
		actual, ok := actualSHA1[name]
		if !ok {
			// Try with ./ prefix (tar entries may vary).
			actual, ok = actualSHA1["./"+name]
		}
		if !ok {
			t.Errorf("missing binary in output: %s", name)
			continue
		}
		if actual != expected {
			t.Errorf("SHA1 mismatch for %s:\n  expected: %s\n  actual:   %s", name, expected, actual)
		} else {
			t.Logf("OK %s = %s", name, actual)
		}
	}

	t.Logf("output tgz size: %d bytes", len(result.tgzBytes))
	t.Logf("log output:\n%s", result.log)
}

// extractPatchFiles reads a patches zip and returns a map of filename -> contents
// for all src/*.yaml files.
func extractPatchFiles(zipData []byte) (map[string][]byte, error) {
	r, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, err
	}

	files := make(map[string][]byte)
	for _, f := range r.File {
		if !strings.HasPrefix(f.Name, "src/") || !strings.HasSuffix(f.Name, ".yaml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", f.Name, err)
		}
		files[f.Name] = data
	}
	return files, nil
}

// extractTgzSHA1 reads a tgz and returns a map of entry name -> SHA1 hex string.
func extractTgzSHA1(tgzData []byte) (map[string]string, error) {
	gr, err := gzip.NewReader(bytes.NewReader(tgzData))
	if err != nil {
		return nil, err
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	sums := make(map[string]string)

	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}

		hasher := sha1.New()
		if _, err := io.Copy(hasher, tr); err != nil {
			return nil, fmt.Errorf("hash %s: %w", h.Name, err)
		}
		sums[h.Name] = fmt.Sprintf("%x", hasher.Sum(nil))
	}

	return sums, nil
}
