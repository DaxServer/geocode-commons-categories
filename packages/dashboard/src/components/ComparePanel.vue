<script setup lang="ts">
import { useGeocodeStore } from '@frontend/stores/geocode'

const store = useGeocodeStore()
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
            {{ store.compareResult.ours?.coords.lat.toFixed(4) }},
            {{ store.compareResult.ours?.coords.lon.toFixed(4) }}
          </span>
        </div>
        <div class="flex gap-2">
          <Tag :severity="store.compareResult.diff.wikidata_match ? 'success' : 'danger'">
            {{ store.compareResult.diff.wikidata_match ? '✓' : '✗' }} Wikidata
          </Tag>
          <Tag :severity="store.compareResult.diff.commons_match ? 'success' : 'danger'">
            {{ store.compareResult.diff.commons_match ? '✓' : '✗' }} Commons
          </Tag>
          <Tag :severity="store.compareResult.diff.admin_level_match ? 'success' : 'danger'">
            {{ store.compareResult.diff.admin_level_match ? '✓' : '✗' }} Admin level
          </Tag>
        </div>
      </div>

      <!-- Side-by-side cards -->
      <div class="grid grid-cols-2 gap-4">

        <!-- Ours -->
        <div class="bg-surface-0 rounded-lg border-t-4 border-blue-500 shadow-sm p-4 flex flex-col gap-3">
          <div class="text-xs font-bold tracking-widest text-blue-500 uppercase">Our Endpoint</div>

          <div v-if="store.compareResult.ours">
            <!-- Wikidata -->
            <div :class="!store.compareResult.diff.wikidata_match ? 'bg-red-50 rounded p-2 -mx-1' : ''">
              <div class="text-xs text-surface-400 mb-1">Wikidata</div>
              <a
                :href="`https://www.wikidata.org/wiki/${store.compareResult.ours.wikidata}`"
                target="_blank"
                class="text-sm text-surface-800 hover:text-blue-600"
              >
                {{ store.compareResult.ours.wikidata }} ↗
              </a>
            </div>

            <!-- Commons -->
            <div :class="!store.compareResult.diff.commons_match ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'">
              <div class="text-xs text-surface-400 mb-1">Commons</div>
              <a
                :href="store.compareResult.ours.commons_cat.url"
                target="_blank"
                class="text-sm text-surface-800 hover:text-blue-600"
              >
                {{ store.compareResult.ours.commons_cat.title }} ↗
              </a>
            </div>

            <!-- Admin level -->
            <div :class="!store.compareResult.diff.admin_level_match ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'">
              <div class="text-xs text-surface-400 mb-1">Admin level</div>
              <div class="text-sm text-surface-800">{{ store.compareResult.ours.admin_level }}</div>
            </div>
          </div>

          <div v-else class="text-sm text-surface-400">No result</div>
        </div>

        <!-- Edward Betts -->
        <div class="bg-surface-0 rounded-lg border-t-4 border-violet-500 shadow-sm p-4 flex flex-col gap-3">
          <div class="text-xs font-bold tracking-widest text-violet-500 uppercase">Edward Betts</div>

          <div v-if="store.compareResult.edwardBetts">
            <!-- Wikidata -->
            <div :class="!store.compareResult.diff.wikidata_match ? 'bg-red-50 rounded p-2 -mx-1' : ''">
              <div class="text-xs text-surface-400 mb-1">Wikidata</div>
              <a
                :href="`https://www.wikidata.org/wiki/${store.compareResult.edwardBetts.wikidata}`"
                target="_blank"
                class="text-sm text-surface-800 hover:text-blue-600"
              >
                {{ store.compareResult.edwardBetts.wikidata }} ↗
              </a>
            </div>

            <!-- Commons -->
            <div :class="!store.compareResult.diff.commons_match ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'">
              <div class="text-xs text-surface-400 mb-1">Commons</div>
              <a
                :href="store.compareResult.edwardBetts.commons_cat.url"
                target="_blank"
                class="text-sm text-surface-800 hover:text-blue-600"
              >
                {{ store.compareResult.edwardBetts.commons_cat.title }} ↗
              </a>
            </div>

            <!-- Admin level -->
            <div :class="!store.compareResult.diff.admin_level_match ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'">
              <div class="text-xs text-surface-400 mb-1">Admin level</div>
              <div class="text-sm text-surface-800">{{ store.compareResult.edwardBetts.admin_level }}</div>
            </div>
          </div>

          <div v-else class="text-sm text-surface-400">No result</div>
        </div>

      </div>
    </template>
  </div>
</template>
