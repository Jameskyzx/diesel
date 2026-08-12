"use client";

import type {
  FillLayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  MapSourceDataEvent,
  StyleSpecification,
} from "maplibre-gl";
import {
  AttributionControl,
  Map as MapLibreMapClass,
  NavigationControl,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  countryGeoFeaturePropertiesSchema,
  type CountryMapSummary,
} from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";

const COUNTRY_SOURCE = "world-countries";
const COUNTRY_FILL_LAYER = "country-fill";
const COUNTRY_LINE_LAYER = "country-lines";
const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_ESTIMATED_HEIGHT = 128;
const TOOLTIP_MIN_TOP = 64;
const TOOLTIP_WIDTH = 224;

const mapStyle: StyleSpecification = {
  layers: [
    {
      id: "background",
      paint: {
        "background-color": "#e9f2f3",
      },
      type: "background",
    },
  ],
  projection: {
    type: "mercator",
  },
  sources: {},
  version: 8,
};

const countryFillLayer: FillLayerSpecification = {
  id: COUNTRY_FILL_LAYER,
  paint: {
    "fill-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#f59e0b",
      ["boolean", ["feature-state", "hover"], false],
      "#4d9e82",
      ["boolean", ["feature-state", "hasData"], false],
      "#167260",
      "#cbd8dc",
    ],
    "fill-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      0.95,
      ["boolean", ["feature-state", "hover"], false],
      0.9,
      ["boolean", ["feature-state", "hasData"], false],
      0.82,
      0.72,
    ],
  },
  source: COUNTRY_SOURCE,
  type: "fill",
};

const countryLineLayer: LineLayerSpecification = {
  id: COUNTRY_LINE_LAYER,
  paint: {
    "line-color": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#92400e",
      ["boolean", ["feature-state", "hover"], false],
      "#135f50",
      "#ffffff",
    ],
    "line-opacity": 0.95,
    "line-width": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      2.2,
      ["boolean", ["feature-state", "hover"], false],
      1.6,
      0.65,
    ],
  },
  source: COUNTRY_SOURCE,
  type: "line",
};

type TooltipState = {
  containerHeight: number;
  containerWidth: number;
  iso3: string;
  name: string;
  summary: CountryMapSummary | null;
  x: number;
  y: number;
};

type WorldMapProps = {
  countries: CountryMapSummary[];
  onSelectCountry: (iso3: string) => void;
  selectedIso3: string | null;
};

function tooltipCoverageText(summary: CountryMapSummary | null): string {
  if (!summary) {
    return "暂无国家详情数据";
  }
  if (!hasDetailedCountryCoverage(summary.dataCoverageStatus)) {
    return summary.dataCoverageStatus === "planned"
      ? "计划覆盖，暂无核验数据"
      : "暂无国家详情数据";
  }
  return summary.isDemo ? "有 Demo 数据，点击查看" : "有已核验数据，点击查看";
}

function setCountryState(
  map: MapLibreMap,
  iso3: string,
  state: Readonly<Record<string, boolean>>,
) {
  map.setFeatureState(
    {
      id: iso3,
      source: COUNTRY_SOURCE,
    },
    state,
  );
}

export function WorldMap({
  countries,
  onSelectCountry,
  selectedIso3,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(selectedIso3);
  const onSelectRef = useRef(onSelectCountry);
  const [mapReady, setMapReady] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const countriesByIso3 = useMemo(
    () => new Map(countries.map((country) => [country.iso3, country])),
    [countries],
  );

  useEffect(() => {
    onSelectRef.current = onSelectCountry;
  }, [onSelectCountry]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new MapLibreMapClass({
      attributionControl: false,
      center: [8, 18],
      container,
      maxZoom: 6,
      minZoom: 0.8,
      renderWorldCopies: false,
      style: mapStyle,
      zoom: 1.15,
    });
    mapRef.current = map;

    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://www.naturalearthdata.com/" rel="noreferrer">Natural Earth</a>',
      }),
    );
    map.addControl(
      new NavigationControl({
        showCompass: false,
      }),
      "bottom-right",
    );

    const clearHoveredCountry = () => {
      if (hoveredRef.current) {
        setCountryState(map, hoveredRef.current, { hover: false });
      }
      hoveredRef.current = null;
      setTooltip(null);
      map.getCanvas().style.cursor = "";
    };

    const handlePointerMove = (event: MapMouseEvent) => {
      const [feature] = map.queryRenderedFeatures(event.point, {
        layers: [COUNTRY_FILL_LAYER],
      });
      const parsed = countryGeoFeaturePropertiesSchema.safeParse(
        feature?.properties,
      );
      if (!parsed.success) {
        clearHoveredCountry();
        return;
      }

      const { ISO3: iso3, name } = parsed.data;
      if (hoveredRef.current && hoveredRef.current !== iso3) {
        setCountryState(map, hoveredRef.current, { hover: false });
      }

      hoveredRef.current = iso3;
      setCountryState(map, iso3, { hover: true });
      map.getCanvas().style.cursor = "pointer";
      setTooltip({
        containerHeight: container.clientHeight,
        containerWidth: container.clientWidth,
        iso3,
        name,
        summary: countriesByIso3.get(iso3) ?? null,
        x: event.point.x,
        y: event.point.y,
      });
    };

    const handleCountryClick = (event: MapLayerMouseEvent) => {
      const parsed = countryGeoFeaturePropertiesSchema.safeParse(
        event.features?.[0]?.properties,
      );
      if (parsed.success) {
        onSelectRef.current(parsed.data.ISO3);
      }
    };

    const handleSourceData = (event: MapSourceDataEvent) => {
      if (
        event.sourceId === COUNTRY_SOURCE &&
        map.isSourceLoaded(COUNTRY_SOURCE)
      ) {
        setMapReady(true);
      }
    };

    map.on("sourcedata", handleSourceData);
    map.on("load", () => {
      map.addSource(COUNTRY_SOURCE, {
        data: "/geo/world-countries.geojson",
        promoteId: "ISO3",
        type: "geojson",
      });
      map.addLayer(countryFillLayer);
      map.addLayer(countryLineLayer);

      for (const country of countries) {
        if (hasDetailedCountryCoverage(country.dataCoverageStatus)) {
          setCountryState(map, country.iso3, { hasData: true });
        }
      }
      if (selectedRef.current) {
        setCountryState(map, selectedRef.current, { selected: true });
      }

      map.on("mousemove", handlePointerMove);
      map.on("mouseleave", clearHoveredCountry);
      map.on("click", COUNTRY_FILL_LAYER, handleCountryClick);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [countries, countriesByIso3]);

  useEffect(() => {
    const map = mapRef.current;
    const previouslySelected = selectedRef.current;
    selectedRef.current = selectedIso3;

    if (!map?.isStyleLoaded()) {
      return;
    }

    if (previouslySelected) {
      setCountryState(map, previouslySelected, { selected: false });
    }
    if (selectedIso3) {
      setCountryState(map, selectedIso3, { selected: true });
    }
    selectedRef.current = selectedIso3;
  }, [selectedIso3]);

  return (
    <div
      aria-label="可交互世界国家地图。可点击国家打开详情。"
      className="relative h-full min-h-[30rem] overflow-hidden rounded-[1.75rem] border border-black/[0.07] bg-[#e9f2f3] shadow-[0_28px_80px_rgb(29_56_47_/_0.12)]"
      data-testid="world-map"
      role="region"
    >
      <div
        className="!absolute inset-0 h-full w-full"
        data-map-ready={mapReady}
        data-testid="map-canvas-container"
        ref={containerRef}
      />
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2 text-xs sm:left-5 sm:top-5">
        <span className="rounded-full border border-emerald-900/10 bg-[#173d31]/95 px-3.5 py-2 font-medium text-white shadow-sm backdrop-blur">
          有数据（Demo / 已核验）
        </span>
        <span className="rounded-full border border-black/[0.06] bg-white/90 px-3.5 py-2 font-medium text-slate-600 shadow-sm backdrop-blur">
          暂无数据
        </span>
      </div>
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-20 w-56 rounded-2xl border border-black/[0.08] bg-[#fffefa]/95 p-4 shadow-[0_20px_50px_rgb(24_53_44_/_0.2)] backdrop-blur"
          data-country-iso3={tooltip.iso3}
          data-testid="map-tooltip"
          style={{
            left: Math.max(
              TOOLTIP_EDGE_PADDING,
              Math.min(
                tooltip.x + 14,
                Math.max(
                  TOOLTIP_EDGE_PADDING,
                  tooltip.containerWidth -
                    TOOLTIP_WIDTH -
                    TOOLTIP_EDGE_PADDING,
                ),
              ),
            ),
            top: Math.max(
              TOOLTIP_MIN_TOP,
              Math.min(
                tooltip.y - 32,
                Math.max(
                  TOOLTIP_MIN_TOP,
                  tooltip.containerHeight -
                    TOOLTIP_ESTIMATED_HEIGHT -
                    TOOLTIP_EDGE_PADDING,
                ),
              ),
            ),
          }}
        >
          <p className="display-title text-lg font-semibold text-[#17382e]">{tooltip.name}</p>
          <p className="mt-0.5 text-[10px] font-semibold tracking-[0.16em] text-emerald-700">
            {tooltip.iso3}
          </p>
          <p className="mt-2 text-xs">
            {tooltipCoverageText(tooltip.summary)}
          </p>
          {tooltip.summary ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              核验：{tooltip.summary.verifiedAt.slice(0, 10)}
              {tooltip.summary.isStale &&
              hasDetailedCountryCoverage(
                tooltip.summary.dataCoverageStatus,
              )
                ? "（可能过期）"
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
