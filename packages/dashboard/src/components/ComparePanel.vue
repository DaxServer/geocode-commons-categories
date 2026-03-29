<script setup lang="ts">
import GeocodeResultCard from '@frontend/components/GeocodeResultCard.vue'
import { useGeocodeStore } from '@frontend/stores/geocode'

const store = useGeocodeStore()

const diffTags = [
  { key: 'wikidata', label: 'Wikidata' },
  { key: 'commons', label: 'Commons' },
  { key: 'admin_level', label: 'Admin level' },
] as const
</script>

<template>
  <div class="flex flex-col flex-1 overflow-auto bg-surface-50 p-4 gap-4">

    <!-- Empty state -->
    <div v-if="!store.compareResult && !store.loading && !store.error"
      class="flex flex-1 items-center justify-center text-surface-400 text-sm">
      Click anywhere on the map to compare a location
    </div>

    <!-- Error state -->
    <Message v-if="store.error" severity="error">{{ store.error }}</Message>

    <!-- Loading -->
    <div v-if="store.loading" class="flex flex-1 items-center justify-center text-surface-400 text-sm">
      Loading…
    </div>

    <!-- Result -->
    <template v-if="store.compareResult && !store.loading">

      <!-- Header -->
      <div class="flex items-baseline justify-between flex-wrap gap-3 pb-3 border-b border-surface-200">
        <div class="flex items-baseline gap-3">
          <span class="font-semibold text-surface-900">
            {{ store.compareResult.ours?.name ?? 'Unknown' }}
          </span>
          <span class="text-xs text-surface-400 font-mono">
            {{ store.compareResult.ours?.coords.lat.toFixed(6) }},
            {{ store.compareResult.ours?.coords.lon.toFixed(6) }}
          </span>
        </div>
        <div class="flex gap-2">
          <Tag
            v-for="tag in diffTags"
            :key="tag.key"
            :severity="store.compareResult.diff[tag.key].match ? 'success' : 'danger'"
          >
            {{ store.compareResult.diff[tag.key].match ? '✓' : '✗' }} {{ tag.label }}
          </Tag>
        </div>
      </div>

      <!-- Side-by-side cards -->
      <div class="grid grid-cols-2 gap-4">
        <GeocodeResultCard
          title="Our Endpoint"
          header-color="blue"
          :result="store.compareResult.ours"
          :show-mismatch-highlight="{
            wikidata: store.compareResult.diff.wikidata.match,
            commons: store.compareResult.diff.commons.match,
            adminLevel: store.compareResult.diff.admin_level.match,
          }"
        />
        <GeocodeResultCard
          title="Edward Betts"
          header-color="violet"
          :result="store.compareResult.edwardBetts"
          :show-mismatch-highlight="{
            wikidata: store.compareResult.diff.wikidata.match,
            commons: store.compareResult.diff.commons.match,
            adminLevel: store.compareResult.diff.admin_level.match,
          }"
        />
      </div>
    </template>
  </div>
</template>
