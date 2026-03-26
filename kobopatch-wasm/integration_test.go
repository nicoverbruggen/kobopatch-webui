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
// All values are provided via environment variables by test-integration.sh,
// which reads from tests/firmware-config.js.
func TestIntegrationPatch(t *testing.T) {
	firmwarePath := os.Getenv("FIRMWARE_ZIP")
	if firmwarePath == "" {
		t.Skip("FIRMWARE_ZIP not set (run test-integration.sh)")
	}

	firmwareZip, err := os.ReadFile(firmwarePath)
	if err != nil {
		t.Skipf("firmware zip not available at %s (run test-integration.sh to download): %v", firmwarePath, err)
	}

	// Read patch files from the patches zip.
	patchesZipPath := os.Getenv("PATCHES_ZIP")
	if patchesZipPath == "" {
		t.Fatal("PATCHES_ZIP not set (run test-integration.sh)")
	}
	patchesZip, err := os.ReadFile(patchesZipPath)
	if err != nil {
		t.Fatalf("could not read patches zip: %v", err)
	}

	patchFiles, configYAML, err := extractPatchFilesAndConfig(patchesZip)
	if err != nil {
		t.Fatalf("could not extract patch files: %v", err)
	}

	// Replace the existing overrides section with our test override.
	// The config from the zip has all patches disabled; we enable one to verify patching works.
	if idx := strings.Index(configYAML, "\noverrides:"); idx != -1 {
		configYAML = configYAML[:idx]
	}
	configYAML += `
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

	// Parse expected checksums from EXPECTED_CHECKSUMS env var.
	// Format: "path1=hash1,path2=hash2,..."
	checksumEnv := os.Getenv("EXPECTED_CHECKSUMS")
	if checksumEnv == "" {
		t.Fatal("EXPECTED_CHECKSUMS not set (run test-integration.sh)")
	}
	expectedSHA1 := map[string]string{}
	for _, entry := range strings.Split(checksumEnv, ",") {
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) == 2 {
			expectedSHA1[parts[0]] = parts[1]
		}
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

// extractPatchFilesAndConfig reads a patches zip and returns the src/*.yaml
// patch files and the kobopatch.yaml config content.
func extractPatchFilesAndConfig(zipData []byte) (map[string][]byte, string, error) {
	r, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, "", err
	}

	files := make(map[string][]byte)
	var configYAML string
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			return nil, "", fmt.Errorf("open %s: %w", f.Name, err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, "", fmt.Errorf("read %s: %w", f.Name, err)
		}

		if f.Name == "kobopatch.yaml" {
			configYAML = string(data)
		} else if strings.HasPrefix(f.Name, "src/") && strings.HasSuffix(f.Name, ".yaml") {
			files[f.Name] = data
		}
	}
	if configYAML == "" {
		return nil, "", fmt.Errorf("kobopatch.yaml not found in patches zip")
	}
	return files, configYAML, nil
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
