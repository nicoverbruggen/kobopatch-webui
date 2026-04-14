//go:build js && wasm

package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"debug/elf"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

// TestIntegrationPatch runs the full patching pipeline with real patch files
// as a smoke test. Checksum validation of patched binaries is handled by
// kobopatch internally; the E2E tests cover the browser flow.
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

	// Sanity-check that the output tgz is a valid gzip/tar archive and
	// capture the patched binaries for structural validation.
	entries, err := extractTgzEntries(result.tgzBytes)
	if err != nil {
		t.Fatalf("could not extract output tgz: %v", err)
	}

	// Structural validation: the patched binaries must still be well-formed
	// ELF files. This catches catastrophic corruption (bad tar/gzip assembly,
	// truncation, byte-level offset errors) without relying on hardcoded
	// SHA1s. kobopatch already verifies the input bytes match each patch's
	// expected preconditions, so if patching succeeds and the output parses
	// as ELF, the result is trustworthy.
	elfTargets := []string{
		"usr/local/Kobo/nickel",
		"usr/local/Kobo/libnickel.so.1.0.0",
	}
	for _, name := range elfTargets {
		data, ok := lookupEntry(entries, name)
		if !ok {
			t.Errorf("missing binary in output: %s", name)
			continue
		}
		f, err := elf.NewFile(bytes.NewReader(data))
		if err != nil {
			t.Errorf("patched %s is not a valid ELF: %v", name, err)
			continue
		}
		f.Close()
	}

	// Confirm the enabled patch actually modified the target binary. This
	// catches regressions where patches silently no-op (e.g. broken override
	// parsing, patch selection bug).
	originalEntries, err := extractOriginalTgzEntries(firmwareZip)
	if err != nil {
		t.Fatalf("could not extract original KoboRoot.tgz: %v", err)
	}
	patchedNickel, ok := lookupEntry(entries, "usr/local/Kobo/nickel")
	if !ok {
		t.Fatal("patched nickel missing from output")
	}
	originalNickel, ok := lookupEntry(originalEntries, "usr/local/Kobo/nickel")
	if !ok {
		t.Fatal("original nickel missing from firmware KoboRoot.tgz")
	}
	if bytes.Equal(patchedNickel, originalNickel) {
		t.Error("patched nickel is identical to the original — patch did not apply")
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

// lookupEntry finds an entry in a tgz entries map, tolerating a "./" prefix.
func lookupEntry(entries map[string][]byte, name string) ([]byte, bool) {
	if data, ok := entries[name]; ok {
		return data, true
	}
	if data, ok := entries["./"+name]; ok {
		return data, true
	}
	return nil, false
}

// extractOriginalTgzEntries reads the firmware zip, finds KoboRoot.tgz inside,
// and returns its regular-file entries.
func extractOriginalTgzEntries(firmwareZip []byte) (map[string][]byte, error) {
	r, err := zip.NewReader(bytes.NewReader(firmwareZip), int64(len(firmwareZip)))
	if err != nil {
		return nil, err
	}
	for _, f := range r.File {
		if f.Name != "KoboRoot.tgz" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		return extractTgzEntries(data)
	}
	return nil, fmt.Errorf("KoboRoot.tgz not found in firmware zip")
}

// extractTgzEntries reads a tgz and returns a map of regular-file entry name
// to its contents, validating that the archive is well-formed.
func extractTgzEntries(tgzData []byte) (map[string][]byte, error) {
	gr, err := gzip.NewReader(bytes.NewReader(tgzData))
	if err != nil {
		return nil, err
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	entries := make(map[string][]byte)

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
		buf, err := io.ReadAll(tr)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", h.Name, err)
		}
		entries[h.Name] = buf
	}

	return entries, nil
}
