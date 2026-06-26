# JS Guidelines — the target the refactor builds toward

These are the rules `src/js` should conform to. The companion doc
[`self-heal-codebase.md`](./self-heal-codebase.md) is a **behavior-preserving
cleanup** (formatting, JSDoc, dead code). _This_ doc is the **structural
target**: how modules should be shaped and what their APIs should read like. The
refactor follows from these.

## The goal

The bar is **readability** — code a teammate (or you, in six months) reads
top-to-bottom and understands. Objects with small, precise, intention-revealing
APIs; functions that do one thing; names that say what they mean. Laravel is the
benchmark for the _feel_ (not the language): you read a line left to right and it
tells you what it does.

Abstractions — a class, a builder, a fluent chain — earn their place only when
they make the code **clearer**. The default is a plain function or method; reach
for something cleverer only where it genuinely reads better. One guideline (§10,
the DOM builder) is marked **[fluent]** because chaining truly fits it; most are
plain. Rule of thumb: chaining pays for _building_ and _querying_ and gets in the
way of _doing_ — `device.readFile(['.kobo', 'version'])` already reads well, while
`device.at('.kobo', 'version').readText()` just adds ceremony and hides where a
failure happened.

SOLID is respected where it pays for itself and skipped where it would only add
ceremony.

## Non-negotiable constraints (inherited from the project)

- Vanilla ES modules, **named exports, no default exports**. Any new helper is
  plain JS — **no new npm dependencies**.
- Prettier owns formatting (4-space, single quotes, `printWidth: 160`); ESLint
  owns correctness (`eqeqeq`, `no-var`, `prefer-const`). Never hand-fix what they
  fix.
- DOM access through `$ / $q / $qa`; user-facing text through the `TL` layer.
- Every refactor keeps `format:check`, `lint`, `build`, `test`, `test:unit`
  green and produces **identical DOM, network calls, analytics events, and
  downloads**.

---

## The rules at a glance

The deep-dives are below; this is the map. **Non-negotiable constraints** are above;
**how to prove a change preserved behavior** and **how to roll it out** are at the
bottom.

| # | Rule | In one line |
| --- | --- | --- |
| 1 | One job per module/function | Split multi-responsibility classes; one level of abstraction per function. |
| 2 | Command/query separation | A method answers _or_ acts — never a query that secretly mutates. |
| 3 | Intention-revealing names | Lift magic strings into one frozen constant per family. |
| 4 | Tell, don't ask | Push _rules_ (not data reads) onto the model that owns them. |
| 5 | Model · view · control | No DOM in the model, no business logic in the view; the view emits intent. |
| 6 | Data ≠ serialization | Caller assembles data; one module per format turns it into text. |
| 7 | Explicit dependencies | Constructor/factory args, not a mutable service-locator `Session`. |
| 8 | Typed/tagged errors | Route on type/tag, never on message text. |
| 9 | Validate at the boundary, fail loud | Guard input where it enters; catch only the error you expect. |
| 10 | [fluent] DOM builder | Build DOM with `el`, not procedural `createElement` walls. |
| 11 | Named subset views _(exploratory)_ | `ui.enabled.count()` over bespoke loops — a sketch, not a mandate. |
| 12 | Validated extension contract | One `defineFeature` checks the shape; compose shared behavior. |
| 13 | Accessibility is behavior | `role`/`aria-*`/`id` links survive every view refactor. |
| 14 | Text via `TL` → `.text()` | All user text through `TL`; into the DOM as text, never `.html()`. |
| 15 | Listener lifecycle | Attach to view-owned nodes; persistent-node listeners need teardown. |
| 16 | Worker protocol contract | One shared, validated message contract; plain data across the boundary. |

---

## 1. One job per module and per function; one level of abstraction

A function does one thing; a module owns one responsibility. Don't mix
high-level orchestration with low-level detail in the same function — extract the
detail and name it.

❌ `patches/ui.js` is a 484-line `PatchUI` that loads zips, tracks edits,
validates additional files, _and_ emits YAML — four reasons to change in one
class. ❌ `patch-list-view.js#renderPatchList` is 280 lines that bucket, sort,
_and_ build every DOM node.

✅ Keep `PatchUI` as the **aggregate** flows talk to — it owns the patch set and
_coordinates_ — and move each responsibility it merely hosts onto a focused
collaborator it composes. The principal methods map as follows (non-exhaustive —
PatchUI keeps anything not listed, e.g. `getPatchFileBytes`, which is on the build
path):

| Collaborator | Absorbs |
| --- | --- |
| `PatchUI` (aggregate) | `render`, `onChange`, holds `patchFiles`; delegates the rest |
| `PatchLoader` (functions, not a class — it's stateless) | `loadFromZip`, `loadFromURL`, `_patchText` |
| `PatchBlacklist` | `loadBlacklist`, `currentBlacklistVersion`, `isBlacklisted`, `getCurrentBlacklist` |
| `PatchEdits` | `applyEdit`'s tracking half, `_trackEdit`, `isModified`, `hasEdits`, `getCustomizations` + the `pristineText`/`modifiedPatches` state |
| `AdditionalFiles` | `addAdditionalFiles`, `addRestoredAdditionalFiles`, `updateAdditionalFileDestination`, `removeAdditionalFile`, `validateAdditionalFiles`, `readAdditionalFileEntries`, `getAdditionalFiles`, `getAdditionalFileCount`, `hasAdditionalFiles` |
| `ui.enabled` view + `eachPatch()` (§11) | `getEnabledCount`, `getEnabledPatches` (`getOverrides` stays on `PatchUI`) |
| `serializeKobopatchConfig` (§6) | the YAML-layout half of `generateConfig` (the config data stays on `PatchUI`) |

`PatchEdits` is the cleanest illustration — today `applyEdit` does _two_ things
(rewrite the file text **and** update the modified-set); the text-rewrite stays
on `PatchUI` because it owns `patchFiles`, the "is this still pristine?"
bookkeeping moves out:

```js
class PatchEdits {
    constructor() { this.pristine = {}; this.modified = {}; }       // filename → …
    capturePristine(patchFiles) { /* snapshot text at load time */ }
    isModified(filename, name) { return !!this.modified[filename]?.has(name); }
    any() { return Object.values(this.modified).some((s) => s.size > 0); }  // was hasEdits()
    customizations() { /* was getCustomizations() */ }
}
```

Each collaborator is now independently testable, and the aggregate keeps only
thin coordinating methods that read at one level of abstraction.

Note two judgment calls: `PatchLoader` stays **plain functions**, not a
static-method class (a class with no instance state is its own smell); and the
aggregate _legitimately_ retains methods that need two collaborators at once
(e.g. an edit touches both `patchFiles` and `PatchEdits`) — coordinating them
**is** its one job.

## 2. Command/query separation: a method answers _or_ acts, not both

Sibling of §1 — "one thing per method." A method either **returns an answer** (a
query, no side effects) or **performs an action** (a command); when one method
does both, its name has to lie about half of what it does. Apply this
pragmatically: Fowler deliberately suspends it for builders (§10), and a command
that returns a _result_ is fine — the line not to cross is a **query that
secretly mutates**.

❌ `KoboDevice.getNestedDirectory(pathParts)` is named like a query but creates
directories as a side effect:

```js
// the name says "get"; the body writes to disk:
dir = await dir.getDirectoryHandle(part, { create: true });
```

✅ Name the mutation, or split it. A pure query already exists
(`resolveDirectory()`, which throws if a segment is missing), so the creating
variant just needs an honest name:

```js
await device.ensureDirectory(pathParts);   // command — creates; the name admits it
await device.resolveDirectory(pathParts);  // query   — read-only; throws if absent
```

The pragmatic exception, stated so the rule isn't over-applied:
`applyReloadManifest(manifest)` mutates the loaded patches **and** returns a
`{ matched, edits, enabled, missing, applied }` summary. That's a command returning a
result — allowed, because the summary is how the caller reports what it restored.
Don't "fix" it. Only the `getNestedDirectory` shape (a _get_ that writes) is the
smell.

## 3. Intention-revealing names; lift magic strings into named constants

Names are searchable documentation — spend the characters, because searchable
names are what make a refactor safe. The substantive fix here is magic strings;
the `get` prefix (below) is a softer style call.

**Lift magic strings into one frozen constant per family.** Several string
"enums" travel the codebase as bare literals — compared in branches, used as
object keys — with no single definition, so a typo (`'verifed'`) fails silently
and the call sites can't be grepped:

| Concept | Raw literals today | Seen in |
| --- | --- | --- |
| device verification | `'verified'` `'mismatch'` `'unknown'` | `version.js` (produced), `connect-flow.js` branches |
| serial-prefix status | `'verified'` `'refurbished'` `'mismatch'` `'unknown'` | `version.js` (produced), `connect-flow.js` (`verificationHints` keys) |
| selected mode | `'patches'` `'nickelmenu'` | `mode-flow.js`, `connect-flow.js` (`session.js` only declares it `null`) |
| worker message type | `'patch'` `'progress'` `'done'` `'error'` | `patch-worker.js`, `runner.js` (see §16) |
| feature cleanup mode | `'optional'` `'always'` | `features/*` |
| review-notice type | `'info'` `'warning'` | `features/*` |
| analytics event (write-only) | `'flow-start'` `'flow-end'` `'add-koreader'` … + payload keys (`method`, `result`, `option`) | `connect-flow.js`, `manual-flow.js`, `nickelmenu-execute.js`, `terminal.js` |

_Two notes on the table._ (1) Device-verification and serial-prefix status **share**
the literals `'verified'`/`'mismatch'`; frozen constants still beat bare literals, but
they won't catch a *cross-family* mixup (a serial-prefix value compared against
`Verification.VERIFIED`) — keep the two enums' use sites distinct. (2) Analytics names
are *write-only* (fed to `track()`, never branched on), so they're a softer case than
the rest — but they sit in the byte-identical bar, so centralize them as
`AnalyticsEvent` for greppability on rename.

✅ Define each family once and compare against it (paired with "tell, don't ask",
§4):

```js
// kobo/device.js
export const Verification = Object.freeze({ VERIFIED: 'verified', MISMATCH: 'mismatch', UNKNOWN: 'unknown' });

if (device.verification === Verification.VERIFIED) { … }   // greppable, typo-proof
```

**Soft note — drop a `get` prefix only when it reads cleaner.** Not a rule.
`getFile`, `getEnabledCount` are perfectly clear and fine to leave. But where
dropping `get` lets the name state the _shape_ of what comes back, prefer it —
`getCurrentBlacklist()` → `blacklist.grouped()` says more than "get" ever did.
This mostly falls out of §11's named subset views anyway; don't go renaming
`get*` methods just to satisfy a guideline.

## 4. Tell, don't ask — push rules into the model

This targets **decisions, not data**. It doesn't forbid reading from objects — it
forbids pulling raw data out to **reconstruct a business rule in the caller**.
Asking a model for data to _render_ is fine; asking for data to _re-derive a rule
the model should own_ is the smell. (Same instinct as the Law of Demeter; it
exists to protect encapsulation — the rule then lives in one place.)

❌ `flows/connect-flow.js` asks three objects, computes the decision, then reaches
into a fourth and feeds it disassembled pieces — three distinct rules (how to
_find_ a set, what "patchable" _means_, how to _load_ a set) leak into the flow:

```js
const match = state.availablePatches.find((p) => p.version === info.firmware);
const canPatchDevice = info.deviceVerification === 'verified';
if (canPatchDevice && match) {
    await state.patchUI.loadFromURL('patches/' + match.filename, {
        version: match.version,
        patchConfig: match.patches,
        testedFirmwareVersion: latestPatchVersionForFamily(state.availablePatches, match.version),
    });
}
```

✅ Each rule moves onto the object that owns it; the flow reads as a sentence:

```js
const patchSet = catalog.forFirmware(info.firmware);   // catalog owns the lookup + version-family math
if (device.isPatchable() && patchSet) {                // device owns the === Verification.VERIFIED check (§3)
    await patchSet.loadInto(patchUI);                  // the set knows its own URL prefix + meta shape
}
```

This guideline _creates_ the collaborators §1 wanted: a `PatchSet` value object
(from `catalog.forFirmware()`), `device.isPatchable()`, and
`patchSet.loadInto(ui)`. §1, §3, and §4 reinforce one another.

**Where the codebase already gets it right (the boundary with §5).**
`patch-list-view.js` asks `ui.isBlacklisted(filename, patch.name)` and
`ui.isModified(filename, name)` — it does **not** reach into
`ui.blacklist[version][file]`. A view asking its model a question about itself is
correct; a view (or flow) re-deriving the model's rules is not. That line is what
keeps "tell, don't ask" from contradicting "views must query the model" (§5).

**Limits — don't fundamentalize it.** Pure data is fine to read directly
(`info.firmware`, `file.size` are data, not behavior — don't wrap every field).
And the Law of Demeter is a heuristic: collapse a dotted reach when it
reconstructs a _rule_ (`state.device.directoryHandle` → `device.hasManifest()`),
not for every property access.

## 5. Separate model · view · control

Three layers, no bleed: the **model** owns data + rules and touches no DOM; the
**view** turns a plain descriptor into DOM and holds no business logic; **control**
(the flow) wires them together. ("Control" here is usually just the flow — see
§7; it's named separately only to mark the seam.)

❌ `renderPatchList` is all three layers in one 280-line function:

- _model:_ `categoryBuckets`/`bucketCounts`, the blacklist-rank sort, and the
  fiddly rule that a mutually-exclusive `PatchGroup` counts as **one** toward the
  total (enabled if any option is);
- _view:_ the `createElement` walls for sections, items, search box;
- _control:_ `input.addEventListener('change', () => { patch.enabled = input.checked; … })`
  — the **view mutating the model directly**.

✅ Split along the layers. The bucket/count functions are already pure, so they
lift straight onto the model as a descriptor:

```js
// MODEL → a plain, serializable descriptor
const sections = ui.patches().groupedByCategory().withCounts();

// VIEW → descriptor in, DOM out; emits intent, never mutates the model
renderSections(container, sections, { onToggle: (patch) => controller.toggle(patch) });

// CONTROL → owns what a toggle *means*
function toggle(patch) { ui.patches().setEnabled(patch); refreshCounts(); }
```

The crux for a no-framework app is **event handlers**: the view still attaches
the listener (it made the element), but the listener just calls a passed-in
`onToggle` callback. The view knows _"a toggle happened"_; control knows _"what
toggling does."_ That seam is the whole guideline.

Payoff: the `PatchGroup` "counts as one" rule and "incompatible patches sort
last" become unit tests over `sections` with zero DOM.

A smaller bleed in the other direction: `connect-flow.js` contains
`renderModel`/`renderSerial`/badge-SVG building — _view_ code living in a _flow_
file. It moves to a view module the flow calls.

**Limits:** not a call for an MVC framework, observables, or data-binding. The
descriptor is a plain object; the view is a dumb function. Testable rules + dumb
views, nothing more.

## 6. Separate structured data from its serialization

Assembling a structured text format (a config file, a YAML/INI document) with
repeated `str +=` smears the format across a method where one stray `\n` or quote
breaks it silently — and welds "what the config is" to "how it's written." Split
them: the caller assembles plain **data**, and **one owner per format** turns that
data into text. A fluent builder is _not_ the answer here — the config is a
fixed-schema, few-field object, so a builder would be ceremony; **serialization,
not building, is the real job.**

❌ `PatchUI.generateConfig()` interleaves the data with 9 `yaml +=` lines:

```js
let yaml = `version: "${this.firmwareVersion}"\n`;
yaml += `in: firmware.zip\n`;
// …8 more `yaml +=`, two in loops…
return yaml;
```

✅ A serializer owns the layout + escaping in one place; `PatchUI` only assembles
the data (already just three fields):

```js
// patches/patch-yaml.js — add the document-layout serializer to the module that ALREADY
// owns yamlScalar (do NOT make a new kobopatch-yaml.js); reuse the escaper, don't reimplement it
export function serializeKobopatchConfig({ version, patches, overrides }) {
    return [
        `version: "${version}"`,
        'in: firmware.zip',
        'out: out/KoboRoot.tgz',
        'log: out/log.txt',
        'patchFormat: kobopatch',
        '',
        'patches:',
        ...Object.entries(patches).map(([file, target]) => `  ${file}: ${target}`),
        '',
        'overrides:',
        ...Object.entries(overrides).flatMap(([file, ps]) => [
            `  ${file}:`,
            ...Object.entries(ps).map(([n, on]) => `    ${yamlScalar(n)}: ${on ? 'yes' : 'no'}`),
        ]),
    ].join('\n') + '\n';
}

// PatchUI keeps only the data assembly:
generateConfig() {
    return serializeKobopatchConfig({
        version: this.firmwareVersion,
        patches: this.patchConfig,
        overrides: this.getOverrides(),
    });
}
```

No `config.toYAML()` method: it welds the two concerns back together — a §1
single-responsibility smell (a pure `toYAML()` is a fine query, so the objection is
mixed responsibilities, not §2). Keep the data and the serializer apart. The NickelMenu `items` config
in `installer.js` (concatenated today) is the second instance — a
`serializeNmItems(...)` owner, same rule.

## 7. Explicit dependencies over a mutable service-locator

`app.js` builds a `Session` then has every `init*` module **assign services and
callbacks onto it** (`state.showError = …`, `state.goToModeSelection = …`). Two
real hazards, both correctness not just style:

1. **Invisible dependencies.** You can't tell what `initConnectFlow(state, { patches })`
   uses without reading all ~350 lines — it reaches for `state.device`,
   `state.patchUI`, `state.availablePatches`, `state.showError`,
   `state.goToModeSelection`, `state.resetDeviceContext`… none in the signature.
2. **Load-bearing order.** `state.showError` exists only _after_ `initErrorScreen`
   runs; hit a flow's error path before that and it's a `TypeError`. (`Session`'s
   constructor pre-declares all these as `null` just so the shape is discoverable
   — a tell that the indirection is a problem being worked around.)

❌ Current:

```js
const state = Object.assign(new Session(), { device: new KoboDevice(), … });
initErrorScreen(state);                       // assigns state.showError as a side effect
initConnectFlow(state, { patches });
```

✅ Each unit takes what it needs and returns an API:

```js
const errors  = createErrorScreen();                                  // → { showError }
const modes   = createModeFlow({ patchUI });                          // → { show }
const connect = createConnectFlow({ device, patchUI, errors, onRecognized: modes.show });
connect.start();
```

A flow's dependencies are now its signature; a missing one fails at wiring time,
loudly, not mid-flow.

**Be precise about the target — it's the _service-locator behavior_, not shared
state.** `Session` also holds genuine cross-flow _data_ (`selectedMode`,
`firmwareVersion`, `reloadManifest`, the result buffers) with a real
`reset()`/`resetDeviceContext()` lifecycle, and that's legitimate. The split:

- **Services & callbacks** → constructor/factory arguments (above). This is the
  whole behavioral change.
- **Genuinely shared mutable data** → stays an explicit object passed in, but a
  plain `WizardState` with a lifecycle — not a bag that doubles as DI container
  _and_ callback registry. (It currently also mixes device context, patch
  selection, NM customization, and result buffers — 3–4 concerns, so §1 applies
  to it too.)

## 8. Errors carry structured tags and are routed by type, not message text

The rule: an error that the UI must react to differently carries **structured
tags** (or a type), and callers route on those — never by matching message text,
which is fragile and breaks the moment the wording changes. Error handling is
**consistent in `kobo/` and ad hoc everywhere else**; the guideline is to extend
the device layer's discipline outward, with `DeviceError` as the exemplar.

The device layer is already the model to copy — `device-errors.js` tags errors
with `deviceWrite` / `deviceOperation` / `devicePath`, and `error-screen.js`
branches on `options.deviceWrite`, not on text. The refinement is to make the
type explicit (a class) so routing can use `instanceof` _and_ the tags can't
drift or be forgotten. **Not a fluent builder** — building an error in steps
(`.while().causedBy()`) is needless chaining; a plain constructor with an options
bag is clearer and easier to throw.

✅ Exemplar — one typed error replacing the four near-identical factory functions;
tags guaranteed by construction, message derived:

```js
class DeviceError extends Error {
    constructor(operation, path, { phase, cause } = {}) {
        const where = phase ? `${formatDevicePath(path)} while ${phase}` : formatDevicePath(path);
        super(`Could not ${operation} ${where}${cause ? `: ${describeError(cause)}` : ''}`, { cause });
        this.deviceOperation = operation;
        this.devicePath = formatDevicePath(path);
        this.deviceWrite = operation === 'write';
    }
}
export { DeviceError };   // classes export at the bottom (Conventions checklist)

throw new DeviceError('write', filePath, { phase: 'creating the writable stream', cause: err });

// routing stays property-based, now also instanceof-aware:
if (err instanceof DeviceError && err.deviceWrite) showRecoveryGuidance(err);
```

❌ The spots that don't yet follow the rule, and how to fix them:

- Flows `throw new Error('…')` with bare strings that downstream code can only
  distinguish by reading the message. Give them a type/tag if anything routes on
  them.
- `patch-worker.js` collapses every failure to `{ type: 'error', message }`,
  discarding whatever tags the cause carried. Preserve the structured fields
  across the worker boundary so the main thread can still route. **Mind the realm
  boundary:** `instanceof` works only same-thread — `postMessage`/structured clone
  strips the prototype _and_ arbitrary own props, so the worker must copy the tags
  into the plain payload (`{ type: 'error', message, deviceWrite, deviceOperation,
  devicePath }`) and the main thread routes on those fields (re-wrapping into a
  `DeviceError` there if it wants `instanceof`). See §16.

The point isn't "wrap everything in a class" — it's that **any error a caller
treats specially must be identifiable by type/tag, not by its prose.**

## 9. Validate at the boundary and fail loud

Two halves: validate input where it enters your code, and when something is
actually wrong, surface it instead of limping on with bad state.

**Validate at the boundary.** `collect()` is the exemplar — it throws on a
missing id, so a typo dies at init instead of becoming a silent `null` that
explodes three steps later. Extend that to other entry points (additional-file
destinations, restored manifest data, **the shape of fetched `index.json`/
`blacklist.json`** — `catalog.js` reads `entry.versions`/`entry.patches` unchecked
today, and that data flows into the generated config and the downloaded `tgz` —
anything user- or file-supplied). Plain guard clauses are usually the clearest
form:

```js
export function validateDestination(dest) {
    if (!dest.trim()) return fail('A destination is required.');
    if (!isInsideAdds(dest)) return fail('The destination must be inside .adds.');
    return ok();
}
```

A small fluent validator (`Validation.of(dest).require(…).reject(…)`) is fine
**when it reads more clearly** than the guard clauses — judge it by readability,
not by a rule count. Plain `if`s are the default; reach for the chain only when it
genuinely reads better.

**Fail loud — but distinguish expected absence from unexpected failure.** Not
every catch is a swallow. The rule of thumb:

> Catch only the specific error you expect and rethrow the rest; never a bare
> `catch {}` (or catch-all) that turns an unexpected failure into an
> expected-looking default.

✅ `device.js` does this right — a missing optional file is a real "not there",
anything else is loud:

```js
} catch (err) {
    if (isNotFoundError(err)) return null;          // expected absence → default is fine
    throw devicePathError('read', filePath, err);   // anything else → loud
}
```

❌ `catalog.js` flattens _every_ failure (network down, malformed JSON, a real
bug) into "zero patches", so a genuine error looks identical to "no patches
exist":

```js
catch (err) {
    console.error('Failed to load patch index:', err);
    return [];   // unexpected failure made invisible
}
```

The smell isn't "returns a default" — it's "treats an _unexpected_ failure as an
_expected_ empty result." Surface it (throw, or route to the error screen).

## 10. [fluent] A DOM builder, instead of procedural `createElement`

DOM construction is the textbook fluent case (jQuery-style, "configuring one
object"), and it's this codebase's biggest readability sink: `checkbox-list.js`,
`patch-list-view.js`, `connect-flow.js`, and `global-ui.js` are walls of
`createElement` + `className` + `appendChild`. One tiny builder —
`shell/el.js`, ~30 lines, no deps — makes DOM read like the tree it produces.
The method set is driven by what those four files actually do (`className`,
`textContent`, `setAttribute`, direct props, `dataset`, `addEventListener`,
`innerHTML` for SVG, `appendChild`):

```js
// shell/el.js
export function el(tag) { return new El(tag); }

class El {
    constructor(tag) { this.node = document.createElement(tag); }
    class(...names) { this.node.classList.add(...names.filter(Boolean)); return this; }
    text(value)     { this.node.textContent = value; return this; }
    html(markup)    { this.node.innerHTML = markup; return this; }    // trusted/static markup ONLY (see below)
    attr(name, v)   { if (v != null) this.node.setAttribute(name, v); return this; }
    prop(name, v)   { this.node[name] = v; return this; }
    data(key, v)    { this.node.dataset[key] = v; return this; }
    on(type, fn, o) { this.node.addEventListener(type, fn, o); return this; }
    when(cond, build) { if (cond) build(this); return this; }
    append(...kids) {
        for (const kid of kids) {
            if (kid == null || kid === false) continue;
            this.node.append(kid instanceof El ? kid.node : kid);     // accepts El or Node
        }
        return this;
    }
    get dom() { return this.node; }   // unwrap at the single insertion point
}
```

**`.html()` is for trusted, static markup only** (the SVG icons below). Any user-
or device-supplied string goes through `.text()`. State this in the guideline
because a builder makes `innerHTML` _easier_ to reach for — draw the XSS line
explicitly.

**`.prop` vs `.attr` — pick by what you're setting, because it changes the DOM.**
Use `.prop` for live form state and reflected JS properties (`checked`, `disabled`,
`selected`, `value`, `indeterminate`, `type`, `name`); use `.attr` for HTML/ARIA
attributes (`id`, `role`, `aria-*`, `viewBox`) and `.data` for `data-*`. This is not
style — it changes the output: `.attr('checked', false)` _sets_ the attribute (the box
renders checked), `.attr('disabled', false)` disables, and `.attr('value', x)` sets only
the default value, so a careless `input.checked = x` → `.attr('checked', x)` silently
breaks the byte-identical goal. (`.prop` assigns blindly — `.prop('name', undefined)`
becomes the string `'undefined'` — so guard the value at the call site.) And `.class()`
feeds `classList.add`, which throws on a token containing a space and de-dupes: split a
multi-class string into args (`.class('a', 'b')`, never `.class('a b')`).

❌ Current `checkbox-list.js` (one item, abridged from ~40 lines):

```js
const label = document.createElement('label');
label.className = 'nm-config-item';
if (item.disabled) label.classList.add('nm-config-item--disabled');
const input = document.createElement('input');
input.type = 'checkbox';
input.name = item.name;
input.checked = item.checked;
if (item.disabled) input.disabled = true;
// …18 more lines…
label.appendChild(input);
container.appendChild(label);
```

✅ Same DOM, read as a tree:

```js
const row = el('label')
    .class('nm-config-item')
    .when(item.disabled, (e) => e.class('nm-config-item--disabled'))
    .append(
        el('input')
            .prop('type', 'checkbox')
            .prop('name', item.name)
            .prop('checked', item.checked)
            .when(item.disabled, (e) => e.prop('disabled', true)),
        el('div').class('nm-config-text').append(
            el('span').class('nm-config-title').text(item.title),
            el('span').class('nm-config-desc').attr('id', descId).text(item.description),
        ),
    );
container.append(row.dom);
```

**The event case** (`patch-list-view.js`) shows the builder carrying the §5 seam —
the view emits intent via a passed-in callback, it doesn't mutate the model:

```js
header.append(
    el('input').prop('type', 'checkbox').prop('checked', patch.enabled)
        .on('change', (e) => onToggle(patch, e.target.checked)),   // §5: emit intent, don't mutate here
    el('span').class('patch-name').text(displayName(patch.name, original)),
);
```

**The SVG dedup — a sibling `icon()` helper.** `connect-flow.js` (`renderModel`)
and `patch-list-view.js` (`firmwareMatchBadge`) paste the _same_
verified/mismatch SVG literals. With `el` in place that collapses to a registry
defined once — and it's the payoff that justifies `.html()` existing:

```js
// shell/icons.js
const SVG = {
    verified: '<svg viewBox="0 0 24 24" …></svg>',
    mismatch: '<svg viewBox="0 0 24 24" …></svg>',
};
export const icon = (name) => el('span').class('icon', `icon--${name}`).html(SVG[name]);
```

Call sites become `icon('verified')`.

## 11. Named subset views — `ui.enabled.count()` (exploratory, not a hard rule)

> **Status: in flux.** This one is a direction we like, not a settled rule. A
> general chainable query DSL (`ui.patches().where().names()`) was considered and
> rejected — nothing in the codebase actually _composes_ filters, so it'd be
> machinery for a use case that doesn't exist. What follows is the lighter shape
> we're leaning toward; treat it as a sketch to validate against real call sites,
> not a mandate.

`PatchUI` answers a few fixed questions with bespoke loops (`getEnabledCount`,
`getEnabledPatches`, …), each re-walking `Object.entries(this.patchFiles)` — the
storage shape duplicated four times. Two small moves clean that up.

**Write the walk once** (centralizes the one piece of storage knowledge):

```js
*eachPatch() {
    for (const [filename, { patches }] of Object.entries(this.patchFiles))
        for (const patch of patches) yield { patch, filename };
}
```

**Expose meaningful _subsets_ as named, read-only views** so the projections read
as what they are:

```js
ui.enabled.count()   // was getEnabledCount()
ui.enabled.names()   // was getEnabledPatches()
ui.enabled.any()     // the real intent behind `getEnabledCount() === 0`
```

```js
get enabled() { return new PatchSelection(() => this.eachPatch(), (e) => e.patch.enabled); }

class PatchSelection {
    constructor(source, keep) { this.source = source; this.keep = keep; }
    *[Symbol.iterator]() { for (const e of this.source()) if (this.keep(e)) yield e; }
    count() { let n = 0; for (const _ of this) n++; return n; }
    names() { return [...this].map((e) => e.patch.name); }
    any()   { for (const _ of this) return true; return false; }   // lazy → early-exit
}
```

It's **lazy**, so `any()` stops at the first match while `count()`/`names()`
consume the whole subset — best of both. And it's deliberately **not chainable**:
a named subset with a few terminals, not a filter pipeline.

Three judgment calls, all open:

- **Whole-set projections stay top-level.** `ui.overrides()` (the full on/off map,
  including disabled patches) and `ui.customizations()` aren't "the enabled
  patches", so they read as top-level verbs, not under `.enabled`. That asymmetry
  is intentional, not inconsistent.
- **Don't pre-build subsets nobody calls.** `enabled` is clearly needed. A
  parallel `ui.modified.count()` is _possible_ with the same `PatchSelection`, but
  only add it when a call site wants it — not speculatively.
- **Whether this earns a class at all** vs. just `enabledCount()`/`enabledNames()`
  flat on `PatchUI` is still open. The grouping reads nicer; the flat version is
  simpler. Validate against how it actually reads in the flows before committing.

## 12. Give extension points an explicit, validated contract (compose shared behavior)

When many independent modules plug into one seam — a plugin registry, a set of
strategies — don't leave the required shape as tribal knowledge in comments. Put
it in **one `define*()` function** that is the single source of truth: it
validates the shape at load time so a violation fails _loud and early_ instead of
silently doing nothing. And where implementations share behavior, they **compose**
it in (spread a shared partial, call a shared helper) rather than inherit from a
base class or copy-paste.

The codebase instance is the NickelMenu feature registry (`nickelmenu/features/*`)
— the best-factored corner already, but the contract is **implicit** (a typo in
`koboRootEntries` just never runs, no error) and it uses `export default`, against
the house rule. The readable object literal stays; one defining function makes the
contract **checked** and the export **named**:

```js
export const nickelclock = defineFeature({
    id: 'nickelclock',
    section: 'Advanced',
    title: 'Install NickelClock',
    description: 'Display the clock in the header while reading…',
    directories: ['.adds/nickelclock'],
    async install(ctx) { /* … */ },          // normal method syntax — no wrappers
    menuItems() { /* … */ },
    async koboRootEntries(ctx) { /* … */ },
    cleanup: { mode: 'optional', title: 'NickelClock', detect: [['.adds', 'nickelclock']], paths: [/* … */] },
});
```

`defineFeature` is the contract owner — it normalizes optional defaults, requires
the core keys, **rejects an unknown (misspelled) hook name**, and returns the literal
as a named export:

```js
const FEATURE_HOOKS = new Set([   // keep in sync with what installer.js actually calls
    'install', 'menuItems', 'koboRootEntries', 'postProcess', 'confSettings', 'reviewNotices',
]);

export function defineFeature(spec) {
    for (const k of ['id', 'section', 'title', 'description'])
        if (spec[k] == null) throw new Error(`Feature missing required "${k}": ${spec.id ?? '(no id)'}`);
    // The motivation made real: a misspelled hook (`koboRootEntrees`) fails HERE, not as a silent no-op.
    for (const [k, v] of Object.entries(spec))
        if (typeof v === 'function' && !FEATURE_HOOKS.has(k))
            throw new Error(`Feature "${spec.id}" has an unknown hook "${k}" — expected one of: ${[...FEATURE_HOOKS].join(', ')}`);
    return { default: false, available: false, ...spec };
}
```

**Compose shared behavior, don't inherit it.** The three home-hiders differ only
by a flag, so the shared part is a spreadable partial — not a base class, not
three copies:

```js
const homeHider = ({ id, title, description, flag }) => defineFeature({
    id, section: 'Interface tweaks', title, description,
    ...togglesExperimentalFlag(flag),        // shared install + menuItems + postProcess
});
```

Two notes:

- **Composition is the _sharing_ sub-rule, not the headline.** The point is the
  explicit contract; composition is just how implementations reuse code (the
  codebase already composes nearly everywhere — features are about the only place
  the inherit-vs-compose question even comes up).
- **Distinct from §8.** §8 validates runtime _data_ crossing a boundary (user
  input, fetched JSON). This validates a developer-facing _interface_ at
  load/registration. Same fail-loud instinct, different target. (Bonus: a
  misspelled _capability_ helper is now an undefined import — caught by ESLint
  `no-undef` even earlier than `defineFeature` runs.)

## 13. Accessibility attributes are behavior, not decoration

The views encode real assistive-tech behavior: `role`, `aria-label`,
`aria-describedby` tied to a generated `id`, `aria-expanded` flipped on click,
`tabindex`, and `aria-hidden`/`focusable="false"` on decorative SVG
(`patch-list-view.js`'s `firmwareMatchBadge` and description toggle, `connect-flow.js`'s
`renderModel`). These are part of "identical DOM": an `el` migration (§10) must carry
every `role`/`aria-*`/`tabindex` across, and an `aria-describedby`↔`id` pair must move
as a **unit** — a dangling reference is worse than none. Treat a dropped or broken aria
attribute as a behavior regression, not a cosmetic diff, and keep at least one
accessibility-tree assertion (the badge, the toggle) in the suite.

## 14. User-facing text comes from the `TL` layer — and reaches the DOM through `.text()`

Every user-visible string resolves through `TL` (`shell/strings.js`); none are inline
literals at call sites. Interpolated text uses TL's **function entries**
(`STATUS.PATCH_COUNT_MULTI(n)`, `WRITE_FAILED(msg)`), never string concatenation of
user text in the view. With the `el` builder (§10), TL strings go through `.text()`,
never `.html()` — `.html()` is reserved for the static SVG/icon registry. That keeps
§10's XSS line intact at the one place text and markup meet, and a TL function entry
that interpolates device-supplied data (e.g. an error message) still lands as text,
not markup.

## 15. Event listeners attach to view-owned nodes; teardown is the case you must flag

This is a long-lived, no-framework SPA whose views re-render by clearing a container
(`container.innerHTML = ''`). That is safe **only** because listeners ride on
freshly-created nodes that get GC'd when the container is cleared — there are ~90
`addEventListener` calls and zero `removeEventListener`, and that invariant is
load-bearing. `el.on()` (§10) makes attaching a listener one more chained call, so
state the rule: attach listeners only to nodes the view creates and discards on
re-render. A listener on a **long-lived** node (`document`, `window`, a persistent
button re-wired each flow) must be attached **once** (module scope), never per-render —
or removed explicitly, using an `AbortController` signal as the teardown handle. A
per-render listener on a persistent node is a leak.

## 16. The worker message protocol is one owned, validated contract

`workers/patch-worker.js` and `patches/runner.js` must agree on a message protocol,
yet today each independently hardcodes the type strings **and** the payload shapes
(`{ type: 'progress', … }`, `{ type: 'done', result }`, `{ type: 'error', message }`).
That is the §12 "don't leave the shape as tribal knowledge" problem at a _process_
boundary. Put the protocol in one shared module both import: the type constants (§3)
**and** the per-type payload shape, with an explicit rule to ignore (or typed-handle)
unknown message types so it can evolve. Because the boundary is `postMessage`
(structured clone), only plain fields survive — class prototypes and `instanceof` do
not (see §8's realm-boundary note) — so the contract is plain data by construction.

---

## Conventions checklist (mechanical)

- **Exports:** classes `export { Thing }` at the bottom; functions/consts inline
  `export`. **No `export default`** — including features (§12). Don't mix inline
  and bottom exports for the same kind of symbol in one file.
- **Naming:** `PascalCase` classes, `UPPER_SNAKE` constants, `kebab-case` files,
  `camelCase` everything else; booleans read `is*/has*/can*`. One verb per
  concept — `render*` everywhere, never `render*` here and `display*` there for
  the same operation. Static named constructors for the builder cases use
  `for(...)` / `of(...)`.
- **Docs:** every module opens with the JSDoc file-header (per
  `self-heal-codebase.md`); every exported function/method gets a one-line intent
  JSDoc.
- **No magic strings:** statuses (`'verified'`/`'mismatch'`), paths, and config
  keys live in named constants, not inline literals at decision points.
- **Layers:** DOM through `el` (§10) + `$ / $q / $qa`; user text through `TL`;
  async via `async/await`, not hand-rolled promise chains.

## How we prove behavior is preserved

"Behavior never changes" is the whole safety claim, so it needs a **check**, not an
eyeball. The five green gates (`format:check`, `lint`, `build`, `test`, `test:unit`)
catch correctness, not output drift — an attribute reorder, a stray blank line, a
reordered class, or a dropped `track()` call passes all five. The repo has **no**
DOM-snapshot or golden-output test today, so for each kind of output use (or first
_build_) the matching check, before and after a slice:

- **DOM** — compare **normalized `outerHTML`** of the migrated view (attributes
  sorted, empty text nodes ignored) against a baseline captured before the change;
  require zero diff. The `el` migrations (§10) are the main risk — see the
  `.prop`/`.attr` trap and the `.class` note. `npm run screenshots` is for human
  visual review, not an automated baseline; don't rely on it alone.
- **Config / YAML (§6)** — an **exact-string** golden test on `generateConfig()`
  output. The current test uses per-line `assert.match` regexes, which miss
  whitespace and ordering — tighten it to full-string equality.
- **Downloads** — _not_ byte-identical archive bytes (gzip/tar timestamps aren't
  reproducible run-to-run), but identical **patched payload**: assert
  `tgzContentSignature` (already in `apply.spec.js`) is unchanged.
- **Analytics & network** — assert the recorded `track()` event list (name +
  payload, **in order**) and the fetch list are unchanged. Presence-only checks
  (`toContainEqual`) miss a double-fire, a drop, or a reorder.

So "identical DOM, network calls, analytics events, and downloads" (the constraint up
top) means _these checks pass_ — not a literal byte-diff of an archive. **If a check
doesn't exist yet, land it before the refactor it guards, not after.**

## How to apply this

1. Land the small primitives behind their own modules + unit tests — the
   genuinely-fluent ones plus the serializer, typed error, and validator:
   `shell/el.js` + `shell/icons.js` (§10), `serializeKobopatchConfig` **added to the
   existing `patches/patch-yaml.js`** (§6 — reuse its `yamlScalar`; do not create a new
   `kobopatch-yaml.js`), `DeviceError` (§8), `defineFeature` (§12). They're additive;
   nothing breaks yet. (§11's `PatchSelection` in `patches/patch-selection.js` is
   **optional** — it's exploratory; land it only if a call site benefits.)
2. Migrate one consumer per primitive as a vertical slice (e.g.
   `checkbox-list.js` → `el`), **proving behavior is preserved with the checks above
   before moving on** — wire each slice to the matching check (DOM diff for views,
   golden string for the serializer).
3. Then sweep the remaining plain-API guidelines module by module, smallest blast
   radius first. Most need no new module; a few add a small value object (§4's
   `PatchSet` + `catalog.forFirmware`/`device.isPatchable`). This is the bulk of the
   work.
4. **Last, the two non-additive, cross-cutting rewrites** that can't be done
   one-consumer-at-a-time. §7 (explicit DI) touches `app.js`, `session.js`, and every
   flow in one commit — the callback bag is shared _bidirectionally_ (a flow both
   reads callbacks others set and writes ones others read), so it can't be flipped
   per-flow. §1 (splitting `PatchUI` into `PatchLoader`/`PatchBlacklist`/`PatchEdits`/
   `AdditionalFiles`) touches every `PatchUI` caller. Sequence both last and treat each
   as one atomic change with its full caller list, not an incremental sweep.

Each step keeps `format:check`, `lint`, `build`, `test`, `test:unit` green and the
rendered app behavior-identical _by the checks above_. Behavior never changes — only
the shape of the code that produces it.

---

## Sources

Best-practice grounding for the fluent-vs-plain rule:

- [Martin Fowler — _FluentInterface_](https://martinfowler.com/bliki/FluentInterface.html)
  (fits "value objects and configurations"; methods "don't make much sense on
  their own"; tension with command/query separation).
- [ryanmcdermott/clean-code-javascript](https://github.com/ryanmcdermott/clean-code-javascript)
  (one thing per function, ≤2–3 args, intention-revealing & searchable names,
  side-effect discipline, SOLID).
- [MDN — JavaScript code-style guidelines](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/JavaScript)
  and [RisingStack — JS clean-coding best practices](https://blog.risingstack.com/javascript-clean-coding-best-practices-node-js-at-scale/).
- [David Barral — _Fluent APIs using method chaining in JavaScript_](https://medium.com/trabe/fluent-apis-using-method-chaining-in-javascript-81b2f03b1700)
  and [BrowserStack — _What is a Fluent Interface?_](https://www.browserstack.com/guide/fluent-interface)
  (when chaining helps; debugging/testing/encapsulation costs).
