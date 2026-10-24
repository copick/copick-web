import { describe, expect, test } from "vitest";
import html from "../../index.html?raw";

/** The inline script of index.html that sets the document base to the app root. */
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

/** Run the script for a page path; returns the base it sets, or where it redirects. */
function load(pathname: string): { base?: string; redirect?: string } {
  const result: { base?: string; redirect?: string } = {};
  const location = {
    pathname,
    search: "?a=1",
    hash: "",
    replace: (url: string) => (result.redirect = url),
  };
  const document = {
    createElement: () => ({ href: "" }),
    head: { appendChild: (el: { href: string }) => (result.base = el.href) },
  };
  new Function("location", "document", script)(location, document);
  return result;
}

describe("the app root under a URL prefix and client routes", () => {
  test.each([
    ["/", "/"],
    ["/index.html", "/"],
    ["/projects/abc123/", "/"],
    ["/rnode/gpu-17/8123/", "/rnode/gpu-17/8123/"],
    [
      "/rnode/gpu-17/8123/projects/bruno-25aug19a-run001/",
      "/rnode/gpu-17/8123/",
    ],
    ["/viewer/copick-web/index.html", "/viewer/copick-web/"],
    // a prefix that itself looks like a route: the last one is the route
    ["/projects/copick/projects/abc123/", "/projects/copick/"],
  ])("the page %s is served from %s", (page, base) => {
    expect(load(page)).toEqual({ base });
  });

  test("a path without its trailing slash gets it first", () => {
    expect(load("/viewer/copick-web/projects/abc123")).toEqual({
      redirect: "/viewer/copick-web/projects/abc123/?a=1",
    });
  });
});
