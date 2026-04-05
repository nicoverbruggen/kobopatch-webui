module github.com/nicoverbruggen/kobopatch-wasm

go 1.23.12

require (
	github.com/pgaskin/kobopatch v0.0.0
	gopkg.in/yaml.v3 v3.0.1
)

replace github.com/pgaskin/kobopatch => ./kobopatch-src

replace gopkg.in/yaml.v3 => github.com/pgaskin/yaml v0.0.0-20190717135119-db0123c0912e // v3-node-decodestrict

require (
	github.com/ianlancetaylor/demangle v0.0.0-20250628045327-2d64ad6b7ec5 // indirect
	github.com/pgaskin/go-libz v0.1.0 // indirect
	github.com/riking/cssparse v0.0.0-20180325025645-c37ded0aac89 // indirect
	golang.org/x/text v0.3.8 // indirect
	rsc.io/arm v0.0.0-20150420010332-9c32f2193064 // indirect
)
