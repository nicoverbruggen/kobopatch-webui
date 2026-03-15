package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"syscall/js"
	"time"

	"github.com/pgaskin/kobopatch/patchfile"
	_ "github.com/pgaskin/kobopatch/patchfile/kobopatch"
	_ "github.com/pgaskin/kobopatch/patchfile/patch32lsb"
	"github.com/pgaskin/kobopatch/patchlib"

	"gopkg.in/yaml.v3"
)

// Config mirrors the kobopatch config structure, but only the fields we need.
type Config struct {
	Version   string
	In        string // unused in WASM, but required by YAML schema
	Out       string // unused in WASM
	Log       string // unused in WASM
	Patches   map[string]string
	Overrides map[string]map[string]bool
}

// patchResult holds the output of a patching operation.
type patchResult struct {
	tgzBytes []byte
	log      string
}

func main() {
	js.Global().Set("kobopatchVersion", js.ValueOf("wasm-1.0.0"))
	js.Global().Set("patchFirmware", js.FuncOf(jsPatchFirmware))

	// Keep the Go runtime alive.
	select {}
}

// jsPatchFirmware is the JS-callable wrapper.
//
// Arguments:
//
//	args[0]: configYAML (string) - the kobopatch.yaml config content
//	args[1]: firmwareZip (Uint8Array) - the firmware zip file bytes
//	args[2]: patchFiles (Object) - map of filename -> Uint8Array patch file contents
//	args[3]: onProgress (Function, optional) - callback(message string) for progress updates
//
// Returns: a Promise that resolves to { tgz: Uint8Array, log: string } or rejects with an error.
func jsPatchFirmware(this js.Value, args []js.Value) interface{} {
	handler := js.FuncOf(func(this js.Value, promiseArgs []js.Value) interface{} {
		resolve := promiseArgs[0]
		reject := promiseArgs[1]

		go func() {
			result, err := runPatch(args)
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}

			// Create Uint8Array for the tgz output.
			tgzArray := js.Global().Get("Uint8Array").New(len(result.tgzBytes))
			js.CopyBytesToJS(tgzArray, result.tgzBytes)

			// Return { tgz: Uint8Array, log: string }
			obj := js.Global().Get("Object").New()
			obj.Set("tgz", tgzArray)
			obj.Set("log", result.log)
			resolve.Invoke(obj)
		}()

		return nil
	})

	return js.Global().Get("Promise").New(handler)
}

func runPatch(args []js.Value) (*patchResult, error) {
	if len(args) < 3 {
		return nil, errors.New("patchFirmware requires 3 arguments: configYAML, firmwareZip, patchFiles")
	}

	// Parse arguments.
	configYAML := args[0].String()

	firmwareZipLen := args[1].Get("length").Int()
	firmwareZip := make([]byte, firmwareZipLen)
	js.CopyBytesToGo(firmwareZip, args[1])

	patchFilesJS := args[2]
	patchFileKeys := js.Global().Get("Object").Call("keys", patchFilesJS)
	patchFiles := make(map[string][]byte)
	for i := 0; i < patchFileKeys.Length(); i++ {
		key := patchFileKeys.Index(i).String()
		val := patchFilesJS.Get(key)
		buf := make([]byte, val.Get("length").Int())
		js.CopyBytesToGo(buf, val)
		patchFiles[key] = buf
	}

	// Optional progress callback.
	var progressFn func(string)
	if len(args) >= 4 && args[3].Type() == js.TypeFunction {
		cb := args[3]
		progressFn = func(msg string) {
			cb.Invoke(msg)
		}
	}

	return patchFirmware([]byte(configYAML), firmwareZip, patchFiles, progressFn)
}

// patchFirmware runs the kobopatch patching pipeline entirely in memory.
func patchFirmware(configYAML []byte, firmwareZip []byte, patchFileContents map[string][]byte, progressFn func(string)) (*patchResult, error) {
	var logBuf bytes.Buffer
	logf := func(format string, a ...interface{}) {
		msg := fmt.Sprintf(format, a...)
		logBuf.WriteString(msg + "\n")
		if progressFn != nil {
			progressFn(msg)
		}
	}

	// Parse config.
	var config Config
	dec := yaml.NewDecoder(bytes.NewReader(configYAML))
	if err := dec.Decode(&config); err != nil {
		return nil, fmt.Errorf("could not parse config YAML: %w", err)
	}

	if config.Version == "" || len(config.Patches) == 0 {
		return nil, errors.New("invalid config: version and patches are required")
	}

	// Open the firmware zip from memory.
	logf("Opening firmware zip (%d MB)...", len(firmwareZip)/1024/1024)
	zipReader, err := zip.NewReader(bytes.NewReader(firmwareZip), int64(len(firmwareZip)))
	if err != nil {
		return nil, fmt.Errorf("could not open firmware zip: %w", err)
	}

	// Find and extract KoboRoot.tgz from the zip.
	logf("Extracting KoboRoot.tgz from firmware...")
	var koboRootTgz io.ReadCloser
	for _, f := range zipReader.File {
		if f.Name == "KoboRoot.tgz" {
			koboRootTgz, err = f.Open()
			if err != nil {
				return nil, fmt.Errorf("could not open KoboRoot.tgz in firmware zip: %w", err)
			}
			break
		}
	}
	if koboRootTgz == nil {
		return nil, errors.New("could not find KoboRoot.tgz in firmware zip")
	}
	defer koboRootTgz.Close()

	gzReader, err := gzip.NewReader(koboRootTgz)
	if err != nil {
		return nil, fmt.Errorf("could not decompress KoboRoot.tgz: %w", err)
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)

	// Prepare the output tar.gz in memory.
	var outBuf bytes.Buffer
	outGZ := gzip.NewWriter(&outBuf)
	outTar := tar.NewWriter(outGZ)
	var outTarExpectedSize int64

	// Iterate over firmware tar entries and apply patches.
	for {
		h, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("could not read firmware tar entry: %w", err)
		}

		// Find which patch files target this entry.
		var matchingPatchFiles []string
		for patchFileName, targetPath := range config.Patches {
			if h.Name == "./"+targetPath || h.Name == targetPath || filepath.Base(targetPath) == h.Name {
				matchingPatchFiles = append(matchingPatchFiles, patchFileName)
			}
		}

		if len(matchingPatchFiles) == 0 {
			continue
		}

		if h.Typeflag != tar.TypeReg {
			return nil, fmt.Errorf("could not patch '%s': not a regular file", h.Name)
		}

		logf("\nPatching %s", h.Name)

		entryBytes, err := io.ReadAll(tarReader)
		if err != nil {
			return nil, fmt.Errorf("could not read '%s' from firmware: %w", h.Name, err)
		}

		pt := patchlib.NewPatcher(entryBytes)

		for _, pfn := range matchingPatchFiles {

			patchData, ok := patchFileContents[pfn]
			if !ok {
				return nil, fmt.Errorf("patch file '%s' not provided", pfn)
			}

			format := detectFormat(pfn)
			formatFn, ok := patchfile.GetFormat(format)
			if !ok {
				return nil, fmt.Errorf("unknown patch format '%s' for file '%s'", format, pfn)
			}

			ps, err := formatFn(patchData)
			if err != nil {
				return nil, fmt.Errorf("could not parse patch file '%s': %w", pfn, err)
			}

			// Apply overrides.
			if overrides, ok := config.Overrides[pfn]; ok {
				logf("  Applying overrides")
				for name, enabled := range overrides {
					if err := ps.SetEnabled(name, enabled); err != nil {
						return nil, fmt.Errorf("could not set override '%s' in '%s': %w", name, pfn, err)
					}
					if enabled {
						logf("    ENABLE  `%s`", name)
					} else {
						logf("    DISABLE `%s`", name)
					}
				}
			}

			if err := ps.Validate(); err != nil {
				return nil, fmt.Errorf("invalid patch file '%s': %w", pfn, err)
			}

			// patchfile.Log is debug-level output (goes to log file in native kobopatch)
			patchfile.Log = func(format string, a ...interface{}) {}

			if err := ps.ApplyTo(pt); err != nil {
				return nil, fmt.Errorf("error applying patches from '%s': %w", pfn, err)
			}
		}

		patchedBytes := pt.GetBytes()
		outTarExpectedSize += h.Size

		// Write patched file to output tar, preserving original attributes.
		if err := outTar.WriteHeader(&tar.Header{
			Typeflag:   h.Typeflag,
			Name:       h.Name,
			Mode:       h.Mode,
			Uid:        h.Uid,
			Gid:        h.Gid,
			ModTime:    time.Now(),
			Uname:      h.Uname,
			Gname:      h.Gname,
			PAXRecords: h.PAXRecords,
			Size:       int64(len(patchedBytes)),
			Format:     h.Format,
		}); err != nil {
			return nil, fmt.Errorf("could not write header for '%s': %w", h.Name, err)
		}

		if _, err := outTar.Write(patchedBytes); err != nil {
			return nil, fmt.Errorf("could not write patched '%s': %w", h.Name, err)
		}

	}

	// Finalize the output tar.gz.
	if err := outTar.Close(); err != nil {
		return nil, fmt.Errorf("could not finalize output tar: %w", err)
	}
	if err := outGZ.Close(); err != nil {
		return nil, fmt.Errorf("could not finalize output gzip: %w", err)
	}

	// Verify consistency.
	logf("\nChecking patched KoboRoot.tgz for consistency")
	verifyReader, err := gzip.NewReader(bytes.NewReader(outBuf.Bytes()))
	if err != nil {
		return nil, fmt.Errorf("could not verify output: %w", err)
	}
	verifyTar := tar.NewReader(verifyReader)
	var verifySum int64
	for {
		vh, err := verifyTar.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("output verification failed: %w", err)
		}
		verifySum += vh.Size
	}
	if verifySum != outTarExpectedSize {
		return nil, fmt.Errorf("output size mismatch: expected %d, got %d", outTarExpectedSize, verifySum)
	}

	return &patchResult{
		tgzBytes: outBuf.Bytes(),
		log:      logBuf.String(),
	}, nil
}

func detectFormat(filename string) string {
	ext := strings.TrimLeft(filepath.Ext(filename), ".")
	ext = strings.ReplaceAll(ext, "patch", "patch32lsb")
	ext = strings.ReplaceAll(ext, "yaml", "kobopatch")
	return ext
}
