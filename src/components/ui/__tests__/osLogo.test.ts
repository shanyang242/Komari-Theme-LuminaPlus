import { describe, expect, it } from "vitest";
import { resolveOsInfo } from "@/components/ui/OsLogo";

describe("resolveOsInfo", () => {
  it("maps a Darwin uname to macOS, not Windows (regression)", () => {
    expect(resolveOsInfo("Darwin 23.1.0").name).toBe("macOS");
    expect(resolveOsInfo("macOS 14.2").name).toBe("macOS");
    expect(resolveOsInfo("Mac OS X").name).toBe("macOS");
  });

  it("does not let short keywords match inside longer words", () => {
    // "win" must not match "darwin"; "nix" must not match "unix".
    expect(resolveOsInfo("Darwin").name).not.toBe("Windows");
    expect(resolveOsInfo("some unix variant").name).not.toBe("NixOS");
  });

  it("still detects common distros", () => {
    expect(resolveOsInfo("Microsoft Windows 10").name).toBe("Windows");
    expect(resolveOsInfo("Ubuntu 22.04 LTS").name).toBe("Ubuntu");
    expect(resolveOsInfo("Debian GNU/Linux 12").name).toBe("Debian");
    expect(resolveOsInfo("Red Hat Enterprise Linux").name).toBe("Red Hat");
    expect(resolveOsInfo("FreeBSD 14.0").name).toBe("FreeBSD");
    expect(resolveOsInfo("NixOS 23.11").name).toBe("NixOS");
  });

  it("falls back to the first token for unknown systems", () => {
    expect(resolveOsInfo("PlanShenghuoOS 1.0").name).toBe("PlanShenghuoOS");
    expect(resolveOsInfo("").name).toBe("Linux");
  });
});
