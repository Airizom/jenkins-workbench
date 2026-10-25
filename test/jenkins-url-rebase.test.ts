import { describe, expect, it } from "vitest";
import { rebaseEnvironmentUrl } from "../src/jenkins/urls";

describe("rebaseEnvironmentUrl", () => {
  it("moves a URL to a new host", () => {
    expect(
      rebaseEnvironmentUrl(
        "https://old.example/job/app/job/main/",
        ["https://old.example/"],
        "https://new.example/"
      )
    ).toBe("https://new.example/job/app/job/main/");
  });

  it("moves a URL to a new context path", () => {
    expect(
      rebaseEnvironmentUrl(
        "https://ci.example/jenkins/job/app/12/",
        ["https://ci.example/jenkins/"],
        "https://ci.example/ci"
      )
    ).toBe("https://ci.example/ci/job/app/12/");
  });

  it("accepts old bases without a trailing slash and tries each one", () => {
    expect(
      rebaseEnvironmentUrl(
        "https://older.example/job/app/",
        ["https://old.example", "https://older.example"],
        "https://new.example/"
      )
    ).toBe("https://new.example/job/app/");
  });

  it("does not prefix again when the new base nests under the old one", () => {
    const oldBases = ["https://h/"];
    const newBase = "https://h/jenkins/";

    expect(rebaseEnvironmentUrl("https://h/job/app/", oldBases, newBase)).toBe(
      "https://h/jenkins/job/app/"
    );
    expect(rebaseEnvironmentUrl("https://h/jenkins/job/app/", oldBases, newBase)).toBeUndefined();
  });

  it("rebases when the new base is a parent of the old one", () => {
    const oldBases = ["https://h/jenkins/"];
    const newBase = "https://h/";

    expect(rebaseEnvironmentUrl("https://h/jenkins/job/app/", oldBases, newBase)).toBe(
      "https://h/job/app/"
    );
    expect(rebaseEnvironmentUrl("https://h/job/app/", oldBases, newBase)).toBeUndefined();
  });

  it("prefers the longest matching old base across A -> B -> A with nested bases", () => {
    // Moved https://h/ -> https://h/jenkins/ -> https://h/: previousUrls is now [h/jenkins/].
    expect(
      rebaseEnvironmentUrl("https://h/jenkins/job/app/", ["https://h/jenkins/"], "https://h/")
    ).toBe("https://h/job/app/");
    expect(
      rebaseEnvironmentUrl(
        "https://h/a/b/job/app/",
        ["https://h/a/", "https://h/a/b/"],
        "https://n/"
      )
    ).toBe("https://n/job/app/");
  });

  it("leaves URLs under none of the old bases untouched", () => {
    expect(
      rebaseEnvironmentUrl(
        "https://other.example/job/app/",
        ["https://old.example/"],
        "https://new.example/"
      )
    ).toBeUndefined();
    expect(
      rebaseEnvironmentUrl(
        "https://old.example.com/job/app/",
        ["https://old.example/"],
        "https://new.example/"
      )
    ).toBeUndefined();
    expect(
      rebaseEnvironmentUrl("https://old.example/job/app/", [], "https://new.example/")
    ).toBeUndefined();
  });

  it("ignores an old base equal to the new base", () => {
    expect(
      rebaseEnvironmentUrl(
        "https://same.example/job/app/",
        ["https://same.example"],
        "https://same.example/"
      )
    ).toBeUndefined();
  });
});
