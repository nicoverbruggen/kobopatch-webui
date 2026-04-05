.PHONY: serve serve-fake-analytics dev test test-headed test-e2e test-wasm test-patches setup-installables setup-wasm build-wasm screenshots

serve:
	bash scripts/serve-locally.sh

serve-fake-analytics:
	bash scripts/serve-locally.sh --fake-analytics

dev:
	bash scripts/serve-locally.sh --dev

test:
	bash scripts/test.sh

test-headed:
	bash scripts/test.sh --headed

test-e2e:
	bash tests/run-e2e.sh

test-wasm:
	bash kobopatch-wasm/test-integration.sh

test-patches:
	bash kobopatch-wasm/test-patches.sh

setup-installables:
	bash installables/setup.sh

setup-wasm:
	bash kobopatch-wasm/setup.sh

build-wasm:
	bash kobopatch-wasm/build.sh

screenshots:
	bash tests/run-screenshots.sh
