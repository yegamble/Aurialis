import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MasterScreen, type MasterScreenProps } from "../MasterScreen";

// Mock the three heavy control bodies so the test isolates MasterScreen's own
// job: routing the active mode → the right child + the animated/testid variants.
vi.mock("../SimpleMastering", () => ({
  SimpleMastering: () => <div data-testid="simple-body" />,
}));
vi.mock("../AdvancedMastering", () => ({
  AdvancedMastering: () => <div data-testid="advanced-body" />,
}));
vi.mock("../DeepMastering", () => ({
  DeepMastering: () => <div data-testid="deep-body" />,
}));

function baseProps(
  overrides: Partial<MasterScreenProps> = {}
): MasterScreenProps {
  return {
    mode: "simple",
    audioFile: new File([], "song.wav"),
    intensity: 50,
    onIntensityChange: vi.fn(),
    genre: "pop" as MasterScreenProps["genre"],
    onGenreChange: vi.fn(),
    toggles: {
      cleanup: false,
      warm: false,
      bright: false,
      wide: false,
      loud: false,
      deharsh: false,
      glueComp: false,
    },
    onToggle: vi.fn(),
    onAutoMaster: vi.fn(),
    autoMasterStatus: { kind: "idle" },
    autoMasterActiveStage: "loudness",
    params: {} as MasterScreenProps["params"],
    onAdvancedParamChange: vi.fn(),
    tonePreset: null,
    onTonePresetChange: vi.fn(),
    outputPreset: null,
    onOutputPresetChange: vi.fn(),
    ...overrides,
  };
}

describe("MasterScreen", () => {
  it("routes each mode to its control body", () => {
    const { rerender } = render(<MasterScreen {...baseProps({ mode: "simple" })} />);
    expect(screen.getByTestId("simple-body")).toBeInTheDocument();
    expect(screen.queryByTestId("advanced-body")).not.toBeInTheDocument();

    rerender(<MasterScreen {...baseProps({ mode: "advanced" })} />);
    expect(screen.getByTestId("advanced-body")).toBeInTheDocument();

    rerender(<MasterScreen {...baseProps({ mode: "deep" })} />);
    expect(screen.getByTestId("deep-body")).toBeInTheDocument();
  });

  it("shows the auto-master progress readout while analyzing", () => {
    render(
      <MasterScreen
        {...baseProps({ mode: "simple", autoMasterStatus: { kind: "analyzing" } })}
      />
    );
    expect(screen.getByTestId("auto-master-progress")).toHaveTextContent(
      /Analyzing/
    );
  });

  it("shows the auto-master error with its failing stage", () => {
    render(
      <MasterScreen
        {...baseProps({
          mode: "simple",
          autoMasterStatus: { kind: "error", message: "boom", stage: "limiter" },
        })}
      />
    );
    expect(screen.getByTestId("auto-master-error")).toHaveTextContent(
      /limiter — boom/
    );
  });

  it("suffixes the status test ids for the mobile variant", () => {
    render(
      <MasterScreen
        {...baseProps({
          mode: "simple",
          testIdSuffix: "-mobile",
          autoMasterStatus: { kind: "analyzing" },
        })}
      />
    );
    expect(screen.getByTestId("auto-master-progress-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("auto-master-progress")).not.toBeInTheDocument();
  });

  it("renders the mode body in the animated (desktop) variant too", () => {
    render(<MasterScreen {...baseProps({ mode: "advanced", animated: true })} />);
    expect(screen.getByTestId("advanced-body")).toBeInTheDocument();
  });
});
