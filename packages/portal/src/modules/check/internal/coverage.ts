/** Coverage: the pages, the Markdown twins and the JSON twins are each exactly the set the book expects. */

const HTML = /^(?:(.+)\/)?index\.html$/;
const MD = /^(.+)\.md$/;
const JSON_TWIN = /^data\/(.+)\.json$/;

const pagesOf = (files: ReadonlyMap<string, string>, shape: RegExp): ReadonlySet<string> =>
  new Set([...files.keys()].flatMap((file) => {
    const found = shape.exec(file);
    return found ? [found[1] ?? "index"] : [];
  }));

const compare = (what: string, held: ReadonlySet<string>, expected: ReadonlySet<string>): readonly string[] => [
  ...[...expected].filter((page) => !held.has(page)).map((page) => `${page}: no ${what}`),
  ...[...held].filter((page) => !expected.has(page)).map((page) => `${page}: a ${what} for no record`),
];

export const coverage = (files: ReadonlyMap<string, string>, pages: readonly string[]): readonly string[] => {
  const expected = new Set(pages);
  return [
    ...(expected.size === pages.length ? [] : ["two records share one page id"]),
    ...compare("page", pagesOf(files, HTML), expected),
    ...compare("Markdown twin", pagesOf(files, MD), expected),
    ...compare("JSON twin", pagesOf(files, JSON_TWIN), expected),
  ];
};
