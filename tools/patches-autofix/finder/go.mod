module finder

go 1.23.12

require github.com/pgaskin/kobopatch v0.0.0

require (
	github.com/ianlancetaylor/demangle v0.0.0-20250628045327-2d64ad6b7ec5 // indirect
	github.com/pgaskin/go-libz v0.1.0 // indirect
	github.com/riking/cssparse v0.0.0-20180325025645-c37ded0aac89 // indirect
	golang.org/x/text v0.3.2 // indirect
	rsc.io/arm v0.0.0-20150420010332-9c32f2193064 // indirect
)

// kobopatch is vendored in-repo (not published at a tagged version), so point
// the dependency at the local source tree used to build the WASM patcher.
replace github.com/pgaskin/kobopatch => ../../kobopatch-wasm/kobopatch-src
