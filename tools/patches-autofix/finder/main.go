// Command finder helps repair kobopatch patches after a Kobo firmware update.
//
// When firmware changes, a patch's symbol anchors still resolve but the call it
// targets has shifted to a different offset, or a symbol was renamed. finder
// reuses kobopatch's OWN symbol/PLT resolver and Thumb branch assembler
// (patchlib) so the addresses it reports match exactly what `kobopatch -t`
// expects — no guessing, no re-implementing the encoding.
//
// Build (from this directory):
//
//	go build -o finder .
//
// Modes:
//
//	finder resolve        <bin> <sym>                          -> file offset of symbol
//	finder resolveplt     <bin> <sym>                          -> PLT stub offset of symbol
//	finder resolveplttail <bin> <sym>                          -> PLT *tail* veneer (SymPLTTail)
//	finder findblx        <bin> <base> <targetPLTsym> [window] -> offsets of a BLX -> PLT target
//	finder findbw         <bin> <base> <targetPLTsym> [window] -> offsets of a B.W -> PLT target
//	finder findbwtail     <bin> <base> <targetPLTsym> [window] -> offsets of a B.W -> PLT *tail* veneer
//
// Use the *tail variants for Thumb->Thumb tail-calls, which branch to the PLT
// tail veneer (plt-4) that SymPLTTail resolves, not the regular PLT stub.
//
// <bin>    is an extracted ELF (e.g. usr/local/Kobo/libnickel.so.1.0.0).
// <sym>    is the mangled or demangled name, e.g. "ReadingMenuView::updateReadingMenu()".
// <base>   is a symbol name OR a 0x-prefixed absolute file offset (for patches
//          that anchor on a raw address). Use 0x0 to scan the whole binary, e.g.
//          to enumerate every caller of a function.
// [window] is how many bytes past <base> to scan (default 6000).
//
// Typical "call shifted" fix: the patch says
//
//	ReplaceBytes: {Base: "Foo::bar()", Offset: 236, FindInstBLX: {SymPLT: "Baz::qux()"}, ...}
//
// and `kobopatch -t` reports "could not find specified bytes at offset". Run
//
//	finder findblx <bin> "Foo::bar()" "Baz::qux()" 1200
//
// If it prints a single MATCH at a new offset, update Offset to that value. More
// than one match means the call is ambiguous — disassemble to pick the right one.
//
// For a renamed symbol ("no such symbol"), find the new name with
//
//	objdump -T <bin> | c++filt | grep -i <substring>
//
// then confirm the call site with `finder findblx` using the new name.
package main

import (
	"fmt"
	"os"
	"strconv"

	"github.com/pgaskin/kobopatch/patchlib"
)

func resolveBase(p *patchlib.Patcher, s string) (int32, error) {
	if len(s) > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
		v, err := strconv.ParseInt(s[2:], 16, 64)
		return int32(v), err
	}
	return p.ResolveSym(s)
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "usage: finder <resolve|resolveplt|findblx|findbw> <bin> <args...>")
		fmt.Fprintln(os.Stderr, "see the package doc comment in main.go for details")
		os.Exit(2)
	}
	mode := os.Args[1]
	data, err := os.ReadFile(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read binary:", err)
		os.Exit(1)
	}
	p := patchlib.NewPatcher(data)
	buf := p.GetBytes()

	switch mode {
	case "resolve":
		a, err := p.ResolveSym(os.Args[3])
		if err != nil {
			fmt.Println("ERR:", err)
			os.Exit(1)
		}
		fmt.Printf("0x%X\n", a)
	case "resolveplt":
		a, err := p.ResolveSymPLT(os.Args[3])
		if err != nil {
			fmt.Println("ERR:", err)
			os.Exit(1)
		}
		fmt.Printf("0x%X\n", a)
	case "resolveplttail":
		a, err := p.ResolveSymPLTTail(os.Args[3])
		if err != nil {
			fmt.Println("ERR:", err)
			os.Exit(1)
		}
		fmt.Printf("0x%X\n", a)
	case "findblx", "findbw", "findbwtail":
		if len(os.Args) < 5 {
			fmt.Fprintln(os.Stderr, "usage: finder", mode, "<bin> <base> <targetPLTsym> [window]")
			os.Exit(2)
		}
		base, err := resolveBase(p, os.Args[3])
		if err != nil {
			fmt.Println("ERR base:", err)
			os.Exit(1)
		}
		var tgt int32
		if mode == "findbwtail" {
			tgt, err = p.ResolveSymPLTTail(os.Args[4])
		} else {
			tgt, err = p.ResolveSymPLT(os.Args[4])
		}
		if err != nil {
			fmt.Println("ERR target:", err)
			os.Exit(1)
		}
		window := int32(6000)
		if len(os.Args) > 5 {
			w, err := strconv.Atoi(os.Args[5])
			if err != nil {
				fmt.Fprintln(os.Stderr, "bad window:", err)
				os.Exit(2)
			}
			window = int32(w)
		}
		fmt.Printf("# base=0x%X targetPLT=0x%X window=%d\n", base, tgt, window)
		count := 0
		for off := int32(0); off < window; off += 2 {
			pos := base + off
			if int(pos)+4 > len(buf) {
				break
			}
			var want []byte
			if mode == "findblx" {
				want = patchlib.AsmBLX(uint32(pos), uint32(tgt))
			} else { // findbw, findbwtail
				want = patchlib.AsmBW(uint32(pos), uint32(tgt))
			}
			if buf[pos] == want[0] && buf[pos+1] == want[1] && buf[pos+2] == want[2] && buf[pos+3] == want[3] {
				fmt.Printf("MATCH offset=%d (0x%X)  addr=0x%X  bytes=%02X %02X %02X %02X\n",
					off, off, pos, want[0], want[1], want[2], want[3])
				count++
			}
		}
		fmt.Printf("# %d match(es)\n", count)
	default:
		fmt.Fprintln(os.Stderr, "unknown mode:", mode)
		os.Exit(2)
	}
}
