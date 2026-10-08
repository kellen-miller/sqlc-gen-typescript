import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import ts from "typescript";
import Database from "better-sqlite3";
import { codegen } from "../src/generate";
import {
  GenerateRequest,
  GenerateResponse,
  Column,
  Identifier,
  Parameter,
  Query,
} from "../src/gen/plugin/codegen_pb";

const directory = mkdtempSync(resolve(".sqlite-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const schema = readFileSync("test/fixtures/schema.sql", "utf8");
const queries = readFileSync("test/fixtures/queries.sql", "utf8");
writeFileSync(join(directory, "schema.sql"), schema);
writeFileSync(join(directory, "queries.sql"), queries);
writeFileSync(
  join(directory, "sqlc.json"),
  JSON.stringify({
    version: "2",
    plugins: [
      {
        name: "ts",
        wasm: { url: `file://${resolve("examples/plugin.wasm")}` },
      },
    ],
    sql: ["functions", "prepared"].map((emit) => ({
      engine: "sqlite",
      schema: "schema.sql",
      queries: "queries.sql",
      codegen: [
        {
          plugin: "ts",
          out: emit,
          options: {
            driver: "better-sqlite3",
            sqlite: { emit, filename: "queries.ts" },
          },
        },
      ],
    })),
  }),
);
execFileSync("sqlc", ["generate", "-f", join(directory, "sqlc.json")]);

function load(mode: string): any {
  const source = readFileSync(join(directory, mode, "queries.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", js)(exports);
  return exports;
}

const functions = load("functions");
const prepared = load("prepared");

function request(options: object, queries: Query[]): GenerateRequest {
  return new GenerateRequest({
    pluginOptions: new TextEncoder().encode(
      JSON.stringify({ driver: "better-sqlite3", ...options }),
    ),
    queries,
  });
}

const basic = new Query({
  name: "Basic",
  filename: "basic.sql",
  cmd: ":one",
  text: "SELECT id FROM items WHERE id = ?",
  columns: [
    new Column({
      name: "id",
      notNull: true,
      type: new Identifier({ name: "integer" }),
    }),
  ],
  params: [
    new Parameter({
      number: 1,
      column: new Column({
        name: "id",
        notNull: true,
        type: new Identifier({ name: "integer" }),
      }),
    }),
  ],
});

test("generated functions run synchronously inside real SQLite transactions", () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    const id = functions.insertNamed(database, {
      name: "first",
      enabled: 1,
      payload: Buffer.from("x"),
      score: null,
    });
    assert.equal(id, 1);
    assert.deepEqual(functions.getItem(database, { id }), {
      id: 1,
      displayName: "first",
      enabled: 1,
      payload: Buffer.from("x"),
      score: null,
    });
    assert.equal(functions.getItem(database, { id: 999 }), null);
    assert.equal(
      functions.insertPositional(database, { name: "second" }),
      undefined,
    );
    assert.deepEqual(functions.findNamed(database, { name: "first" }), [
      { id: 1, name: "first" },
    ]);
    assert.deepEqual(
      functions.findNumbered(database, { param1: 1, param2: 2 }),
      [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ],
    );
    assert.deepEqual(functions.findRepeated(database, { id: 1, id_2: 2 }), [
      { id: 1 },
      { id: 2 },
    ]);
    assert.equal(functions.listItems(database)[0]["Quoted Alias"], "first");
    assert.deepEqual(functions.literals(database, { id: 1 }), {
      literalValue: "?1 AS imaginaryAlias",
      actualName: "first",
    });
    assert.throws(
      database.transaction(() => {
        functions.insertPositional(database, { name: "rolled back" });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(functions.listItems(database).length, 2);
    assert.equal(functions.deleteItem(database, { id: 2 }), 1);
    assert.equal(functions.deleteItem(database, { id: 2 }), 0);
  } finally {
    database.close();
  }
});

test("prepared mode retains get/all/run/pluck and object/tuple bindings", () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    assert.equal(
      prepared
        .insertNamed(database)
        .run({ name: "first", enabled: 0, payload: null, score: 2.5 })
        .lastInsertRowid,
      1,
    );
    prepared.insertPositional(database).run("second");
    assert.deepEqual(prepared.findNamed(database).all({ name: "first" }), [
      { id: 1, name: "first" },
    ]);
    assert.deepEqual(
      prepared.findNumbered(database).pluck().all({ param1: 1, param2: 2 }),
      [1, 2],
    );
    assert.equal(prepared.getItem(database).pluck().get(1), 1);
    assert.equal(prepared.getItem(database).get(999), undefined);
    assert.deepEqual(prepared.literals(database).get(1), {
      literalValue: "?1 AS imaginaryAlias",
      actualName: "first",
    });
    assert.equal(prepared.deleteItem(database).run(2).changes, 1);
  } finally {
    database.close();
  }
});

test("both output modes compile with strict better-sqlite3 types", () => {
  const fixture = join(directory, "types.ts");
  writeFileSync(
    fixture,
    `import type Database from 'better-sqlite3';
import * as f from './functions/queries';
import * as p from './prepared/queries';
declare const database: Database.Database;
const id: number | undefined = p.getItem(database).pluck().get(1);
const ids: number[] = p.findNumbered(database).pluck().all({param1: 1, param2: 2});
const name: string | undefined = f.getItem(database, {id: 1})?.displayName;
// @ts-expect-error SQLite booleans are numeric.
f.insertNamed(database, {name: 'bad', enabled: true, payload: null, score: null});
// @ts-expect-error Positional bindings require numbers.
p.getItem(database).get('bad');
// @ts-expect-error Scalar pluck does not return a row object.
const row: p.GetItemRow | undefined = p.getItem(database).pluck().get(1);
`,
  );
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
    "--target",
    "ES2020",
    fixture,
  ]);
});

test("parameter overrides validate targets and preserve the executable SQL", () => {
  const response = codegen(
    request(
      {
        sqlite: {
          emit: "prepared",
          parameter_types: { Basic: { "1": "number | null" } },
        },
      },
      [basic],
    ),
  );
  const output = new TextDecoder().decode(response.files[0].contents);
  assert.match(output, /\[\s*number \| null\s*\]/);
  assert.match(output, /SELECT id FROM items WHERE id = \?/);
  assert.throws(
    () =>
      codegen(
        request(
          { sqlite: { parameter_types: { Missing: { "1": "number" } } } },
          [basic],
        ),
      ),
    /unknown query/,
  );
  assert.throws(
    () =>
      codegen(
        request({ sqlite: { parameter_types: { Basic: { "2": "number" } } } }, [
          basic,
        ]),
      ),
    /unknown parameter/,
  );
  assert.throws(
    () =>
      codegen(
        request(
          { sqlite: { parameter_types: { Basic: { "1": "any; evil" } } } },
          [basic],
        ),
      ),
    /invalid SQLite parameter type/,
  );
});

test("generation emits one file per group and can combine source files", () => {
  const other = new Query({ ...basic, name: "Other", filename: "other.sql" });
  assert.equal(codegen(request({}, [basic, other])).files.length, 2);
  const combined = codegen(
    request({ sqlite: { filename: "queries.ts" } }, [basic, other]),
  );
  assert.equal(combined.files.length, 1);
  assert.equal(combined.files[0].name, "queries.ts");
  const output = new TextDecoder().decode(combined.files[0].contents);
  assert.match(output, /function basic/);
  assert.match(output, /function other/);
});

test("invalid modes, commands, output paths and ambiguous row names fail explicitly", () => {
  assert.throws(
    () => codegen(request({ sqlite: { emit: "invalid" } }, [basic])),
    /unknown SQLite emit mode/,
  );
  assert.throws(
    () => codegen(request({ sqlite: { filename: "..\/evil.ts" } }, [basic])),
    /simple .ts filename/,
  );
  assert.throws(
    () => codegen(request({}, [new Query({ ...basic, cmd: ":copyfrom" })])),
    /unsupported SQLite command/,
  );
  assert.throws(
    () =>
      codegen(
        request({}, [
          new Query({
            ...basic,
            columns: [basic.columns[0], basic.columns[0]],
          }),
        ]),
      ),
    /require SQL aliases/,
  );
});

test("Node process transport produces the same protobuf response as the generator", () => {
  const input = request({ sqlite: { emit: "prepared" } }, [basic]);
  const response = GenerateResponse.fromBinary(
    execFileSync(process.execPath, ["out-node.cjs"], {
      input: input.toBinary(),
    }),
  );
  assert.deepEqual(response.toJson(), codegen(input).toJson());
});

test("SQLite affinity mappings retain nullability and avoid Date/boolean/any", () => {
  const columns = [
    new Column({
      name: "label",
      notNull: true,
      type: new Identifier({ name: "VARCHAR(40)" }),
    }),
    new Column({
      name: "enabled",
      notNull: true,
      type: new Identifier({ name: "BOOLEAN" }),
    }),
    new Column({ name: "date", type: new Identifier({ name: "datetime" }) }),
    new Column({ name: "expression", type: new Identifier({ name: "" }) }),
  ];
  const query = new Query({ ...basic, columns });
  const output = new TextDecoder().decode(
    codegen(request({}, [query])).files[0].contents,
  );
  assert.match(output, /"label": string/);
  assert.match(output, /"enabled": number/);
  assert.match(output, /"date": unknown/);
  assert.match(output, /"expression": unknown/);
  assert.doesNotMatch(output, /: any|: boolean|: Date/);
});
