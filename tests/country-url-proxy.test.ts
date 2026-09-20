import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";

const origin = "https://diesel.example:8443";

function request(path: string, method = "GET") {
  return new NextRequest(new URL(path, origin), { method });
}

function expectPassThrough(response: ReturnType<typeof proxy>) {
  expect(response.status).toBe(200);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("location")).toBeNull();
}

describe("country URL request proxy", () => {
  it("matches only the country detail route", () => {
    expect(config.matcher).toBe("/countries/:iso3");
  });

  it.each(["GET", "HEAD"])("returns one same-origin HTTP 307 for %s with path and filter changes", (method) => {
    const path = "/countries/%20chn%20?utm_source=first&powerKw=300.0&applicationScope=non-road&asOf=bad-date&productModelCode=%20demo-eng-300%20&utm_source=second";
    const response = proxy(request(path, method));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${origin}/countries/CHN?applicationScope=non-road&powerKw=300&productModelCode=DEMO-ENG-300&utm_source=first&utm_source=second`,
    );
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expectPassThrough(proxy(new NextRequest(response.headers.get("location")!, { method })));
  });

  it.each(["chn", "%63hn", "ChN", "%20CHN%20"])("canonicalizes the decoded country segment %s", (iso3) => {
    const response = proxy(request(`/countries/${iso3}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/countries/CHN`);
  });

  it("normalizes catalog countries even when they have no detailed data", () => {
    const response = proxy(request("/countries/afg?powerKw=300.0"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/countries/AFG?powerKw=300`);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("passes through %s without changing country or filter values", (method) => {
    expectPassThrough(proxy(request("/countries/chn?powerKw=300.0", method)));
  });

  it.each([
    "/",
    "/map",
    "/api/countries/chn?powerKw=300.0",
    "/countries",
    "/countries/",
    "/countries/chn/",
    "/countries/chn/extra",
    "/countries/chn//",
    "/countries/zzZ?powerKw=invalid",
    "/countries/CH",
    "/countries/CHNN",
    "/countries/12A",
    "/countries/%E4%B8%AD%E5%9B%BD",
    "/countries/%",
    "/countries/%E0%A4%A",
    "/countries/%2Fchn",
    "/countries/chn%2Fextra",
    "/countries/%2563hn",
    "/countries/%2520chn%2520",
  ])("leaves invalid, unknown, or out-of-scope path %s to the existing route", (path) => {
    expectPassThrough(proxy(request(path)));
  });

  it.each([
    "/countries/CHN",
    "/countries/%43%48%4e",
    "/countries/CHN?powerKw=%33%30%30",
    "/countries/CHN?productModelCode=DEMO-ENG-300&powerKw=300&applicationScope=non-road&asOf=2026-09-14",
    "/countries/CHN?utm_source=a%20b&powerKw=300&utm_source=c+d",
    "/countries/CHN?__proto__=a&constructor=b&toString=c&__proto__=d",
  ])("does not redirect canonical or encoding-equivalent URL %s", (path) => {
    expectPassThrough(proxy(request(path)));
  });

  it("collapses repeated known filters and keeps every unknown value during redirect", () => {
    const response = proxy(request(
      "/countries/CHN?powerKw=300&powerKw=100&applicationScope=non-road&applicationScope=marine&asOf=invalid&asOf=2026-09-14&productModelCode=demo-eng-300&productModelCode=DEMO-ENG-100&__proto__=first&constructor=one&__proto__=second&constructor=two&toString=&toString=custom&utm_source=a%2Bb%26c%3Dd&utm_source=%E4%B8%AD%E6%96%87",
    ));

    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe(origin);
    expect(destination.pathname).toBe("/countries/CHN");
    expect(destination.searchParams.getAll("powerKw")).toEqual(["300"]);
    expect(destination.searchParams.getAll("applicationScope")).toEqual(["non-road"]);
    expect(destination.searchParams.has("asOf")).toBe(false);
    expect(destination.searchParams.getAll("productModelCode")).toEqual(["DEMO-ENG-300"]);
    expect(destination.searchParams.getAll("__proto__")).toEqual(["first", "second"]);
    expect(destination.searchParams.getAll("constructor")).toEqual(["one", "two"]);
    expect(destination.searchParams.getAll("toString")).toEqual(["", "custom"]);
    expect(destination.searchParams.getAll("utm_source")).toEqual(["a+b&c=d", "中文"]);
    expectPassThrough(proxy(new NextRequest(destination)));
  });

  it("removes every invalid filter without injecting a date or leaving an empty query", () => {
    const response = proxy(request(
      "/countries/CHN?applicationScope=invalid&asOf=2025-02-29&powerKw=-1&productModelCode=%20",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/countries/CHN`);
    expectPassThrough(proxy(request("/countries/CHN")));
  });

  it("keeps redirect-like unknown values as metadata on the request origin", () => {
    const incoming = new NextRequest(
      `${origin}/countries/chn?next=https%3A%2F%2Fother.example%2F&redirect=%2F%2Fother.example%2F`,
      { headers: { "x-forwarded-host": "other.example" } },
    );
    const response = proxy(incoming);
    const destination = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(destination.origin).toBe(origin);
    expect(destination.pathname).toBe("/countries/CHN");
    expect(destination.searchParams.get("next")).toBe("https://other.example/");
    expect(destination.searchParams.get("redirect")).toBe("//other.example/");
  });
});
