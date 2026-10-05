JAVY ?= ./javy
SQLC ?= sqlc

.PHONY: build test generate

build:
	npm run build
	$(JAVY) compile out.js -o examples/plugin.wasm

test: build
	npm test

generate: build
	cd examples && $(SQLC) -f sqlc.dev.yaml generate

src/gen/plugin/codegen_pb.ts: buf.gen.yaml
	buf generate --template buf.gen.yaml buf.build/sqlc/sqlc --path plugin/
