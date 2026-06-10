# Shared environment for the Playwright runner scripts (sourced, not executed).
#
# Silence Playwright's DEP0205 (`module.register()`) deprecation warning, emitted
# by its ESM loader on Node 26+. Scoped to this one warning code so genuine
# deprecations still surface.
export NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=DEP0205"
