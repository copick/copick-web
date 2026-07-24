import { Overlay } from "@idetik/core";
import { useEffect, useRef } from "react";
import { Idetik } from "../Idetik";

type Align = "start" | "center" | "end";

const unitAbbreviations = new Map<string, string>([
  ["angstrom", "Å"],
  ["attometer", "am"],
  ["centimeter", "cm"],
  ["decimeter", "dm"],
  ["exameter", "Em"],
  ["femtometer", "fm"],
  ["foot", "ft"],
  ["gigameter", "Gm"],
  ["hectometer", "hm"],
  ["inch", "in"],
  ["kilometer", "km"],
  ["megameter", "Mm"],
  ["meter", "m"],
  ["micrometer", "µm"],
  ["mile", "mi"],
  ["millimeter", "mm"],
  ["nanometer", "nm"],
  ["parsec", "pc"],
  ["petameter", "Pm"],
  ["picometer", "pm"],
  ["terameter", "Tm"],
  ["yard", "yd"],
  ["yoctometer", "ym"],
  ["yottameter", "Ym"],
  ["zeptometer", "zm"],
  ["zettameter", "Zm"],
]);

function getUnitAbbreviation(unit: string | undefined): string {
  if (unit === undefined) return "";
  return unitAbbreviations.get(unit.toLowerCase()) ?? unit;
}

class ScientificNumber {
  constructor(
    readonly mantissa: number,
    readonly exponent: number
  ) {}

  value(): number {
    return this.mantissa * Math.pow(10, this.exponent);
  }

  format(): string {
    if (this.exponent >= -2) {
      return this.value().toFixed(Math.max(0, -this.exponent));
    }
    return this.value().toExponential(2);
  }

  static floor(x: number): ScientificNumber {
    if (x === 0) return new ScientificNumber(0, 0);
    const exponent = Math.floor(Math.log10(Math.abs(x)));
    return new ScientificNumber(Math.floor(x / Math.pow(10, exponent)), exponent);
  }
}

const ITEMS_CLASS: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

const TEXT_CLASS: Record<Align, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

interface ScaleBarProps {
  viewer: Idetik | null;
  unit?: string;
  align?: Align;
}

export function ScaleBar({ viewer, unit, align = "start" }: ScaleBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  const unitAbbreviation = getUnitAbbreviation(unit);

  useEffect(() => {
    if (!viewer) return;

    let lastWidthWorld: number | undefined;
    const overlay: Overlay = {
      update() {
        const container = containerRef.current;
        const line = lineRef.current;
        const text = textRef.current;
        if (!container || !line || !text) return;

        const widthWorld = container.clientWidth * viewer.worldPerPixel();
        if (widthWorld === lastWidthWorld) return;
        lastWidthWorld = widthWorld;

        const nice = ScientificNumber.floor(widthWorld);
        line.style.width = `${(nice.value() / widthWorld) * 100}%`;
        text.textContent = `${nice.format()} ${unitAbbreviation}`;
      },
    };

    viewer.addOverlay(overlay);
    return () => {
      viewer.removeOverlay(overlay);
    };
  }, [viewer, unitAbbreviation]);

  return (
    <div ref={containerRef} className={`flex flex-col ${ITEMS_CLASS[align]} w-full h-full gap-sds-xs`}>
      <div
        ref={textRef}
        className={`text-white text-base [text-shadow:black_1px_1px_1px,black_-1px_-1px_1px,black_1px_-1px_1px,black_-1px_1px_1px] font-sds-code ${TEXT_CLASS[align]}`}
      />
      <div ref={lineRef} className="bg-white h-sds-m border-[thin] border-solid border-black" />
    </div>
  );
}
