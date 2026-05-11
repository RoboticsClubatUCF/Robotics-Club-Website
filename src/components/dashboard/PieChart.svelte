<script lang="ts">
  export let items: { label: string; count: number }[] = [];
  export let title = '';

  const COLORS = [
    '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
    '#0ea5e9', '#a855f7', '#10b981', '#f43f5e', '#eab308'
  ];

  const CX = 100;
  const CY = 100;
  const R_OUTER = 90;
  const R_INNER = 50;

  $: nonZero = items.filter((d) => d.count > 0);
  $: total = nonZero.reduce((s, d) => s + d.count, 0);

  type Slice = {
    label: string;
    count: number;
    pct: number;
    startAngle: number;
    endAngle: number;
    color: string;
    midAngle: number;
  };

  $: slices = (() => {
    const result: Slice[] = [];
    let cumulative = 0;
    nonZero.forEach((d, i) => {
      const pct = d.count / total;
      const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      cumulative += pct;
      const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      result.push({
        label: d.label,
        count: d.count,
        pct,
        startAngle,
        endAngle,
        color: COLORS[i % COLORS.length],
        midAngle: (startAngle + endAngle) / 2
      });
    });
    return result;
  })();

  function arc(slice: Slice): string {
    if (nonZero.length === 1) {
      return [
        `M ${CX} ${CY - R_OUTER}`,
        `A ${R_OUTER} ${R_OUTER} 0 1 1 ${CX - 0.001} ${CY - R_OUTER}`,
        `L ${CX} ${CY - R_INNER}`,
        `A ${R_INNER} ${R_INNER} 0 1 0 ${CX - 0.001} ${CY - R_INNER}`,
        'Z'
      ].join(' ');
    }

    const large = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;

    const ox1 = CX + R_OUTER * Math.cos(slice.startAngle);
    const oy1 = CY + R_OUTER * Math.sin(slice.startAngle);
    const ox2 = CX + R_OUTER * Math.cos(slice.endAngle);
    const oy2 = CY + R_OUTER * Math.sin(slice.endAngle);

    const ix1 = CX + R_INNER * Math.cos(slice.endAngle);
    const iy1 = CY + R_INNER * Math.sin(slice.endAngle);
    const ix2 = CX + R_INNER * Math.cos(slice.startAngle);
    const iy2 = CY + R_INNER * Math.sin(slice.startAngle);

    return [
      `M ${ox1} ${oy1}`,
      `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${ox2} ${oy2}`,
      `L ${ix1} ${iy1}`,
      `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${ix2} ${iy2}`,
      'Z'
    ].join(' ');
  }

  let hovered: Slice | null = null;
</script>

<div class="flex flex-col items-center gap-6 w-full">
  {#if title}
    <h3 class="h4 text-center">{title}</h3>
  {/if}

  {#if nonZero.length === 0}
    <p class="opacity-40 italic text-sm py-12">No data available.</p>
  {:else}
    <div class="flex flex-col md:flex-row items-center gap-8 w-full justify-center">
      <!-- SVG Donut Chart -->
      <div class="relative shrink-0" style="width:220px;height:220px">
        <svg viewBox="0 0 200 200" width="220" height="220">
          {#each slices as slice}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <!-- svelte-ignore a11y-mouse-events-have-key-events -->
            <path
              d={arc(slice)}
              fill={slice.color}
              stroke="var(--color-surface-100)"
              stroke-width="1.5"
              class="transition-opacity duration-150 cursor-pointer"
              style="opacity: {hovered === null || hovered === slice ? 1 : 0.4}"
              on:mouseover={() => (hovered = slice)}
              on:mouseleave={() => (hovered = null)}
            />
          {/each}
          <!-- Center label -->
          {#if hovered}
            <text x={CX} y={CY - 8} text-anchor="middle" class="fill-current text-xs font-bold" font-size="10" font-weight="bold">
              {hovered.count}
            </text>
            <text x={CX} y={CY + 6} text-anchor="middle" class="fill-current text-xs" font-size="8">
              {(hovered.pct * 100).toFixed(1)}%
            </text>
          {:else}
            <text x={CX} y={CY - 4} text-anchor="middle" class="fill-current font-bold" font-size="14" font-weight="bold">
              {total}
            </text>
            <text x={CX} y={CY + 10} text-anchor="middle" class="fill-current opacity-60" font-size="9">
              total
            </text>
          {/if}
        </svg>
      </div>

      <!-- Legend -->
      <div class="flex flex-col gap-2 min-w-0 max-w-xs w-full">
        {#each slices as slice, i}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <!-- svelte-ignore a11y-mouse-events-have-key-events -->
          <div
            class="flex items-center gap-2 cursor-default rounded px-2 py-1 transition-colors"
            style="background: {hovered === slice ? slice.color + '22' : 'transparent'}"
            on:mouseover={() => (hovered = slice)}
            on:mouseleave={() => (hovered = null)}
          >
            <div
              class="shrink-0 rounded-sm"
              style="width:12px;height:12px;background:{slice.color}"
            />
            <span class="text-sm truncate flex-1">{slice.label}</span>
            <span class="text-sm font-semibold shrink-0">{slice.count}</span>
            <span class="text-xs opacity-50 shrink-0 w-12 text-right">
              {(slice.pct * 100).toFixed(1)}%
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
