import { describe, expect, test } from "vitest";
import { APERTURE_SETTINGS_COMMAND, registerApertureSettings } from "./index";

interface RegisteredCommand {
  name: string;
  options: { description?: string };
}

function makePi() {
  const commands: RegisteredCommand[] = [];
  const pi = {
    registerCommand: (name: string, options: { description?: string }) => {
      commands.push({ name, options });
    },
  };
  return { commands, pi: pi as never };
}

describe("registerApertureSettings", () => {
  test("registers the main settings command", () => {
    const { commands, pi } = makePi();

    registerApertureSettings(
      pi,
      () => {},
      () => [],
    );

    expect(commands[0]?.name).toBe(APERTURE_SETTINGS_COMMAND);
  });

  test("registers one shortcut command per capability tab", () => {
    const { commands, pi } = makePi();

    registerApertureSettings(
      pi,
      () => {},
      () => [],
    );

    const names = commands.map((command) => command.name);
    expect(names).toEqual([
      APERTURE_SETTINGS_COMMAND,
      "aperture:proxy",
      "aperture:dedicated",
      "aperture:mcp",
    ]);
  });

  test("describes shortcuts explicitly", () => {
    const { commands, pi } = makePi();

    registerApertureSettings(
      pi,
      () => {},
      () => [],
    );

    expect(commands[1]?.options.description).toBe(
      "Edit Aperture proxy routing",
    );
    expect(commands[2]?.options.description).toBe(
      "Edit Aperture dedicated providers",
    );
    expect(commands[3]?.options.description).toBe("Edit Aperture MCP settings");
  });
});
