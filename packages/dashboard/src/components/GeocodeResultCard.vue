<script setup lang="ts">
import type { EdwardBettsResponse, GeocodeResponse } from '@backend/types/geocode.types'

defineProps<{
  title: string
  headerColor: 'blue' | 'violet'
  result: GeocodeResponse | EdwardBettsResponse | null
  showMismatchHighlight: {
    wikidata: boolean
    commons: boolean
    adminLevel: boolean
  }
}>()
</script>

<template>
  <div
    class="bg-surface-0 rounded-lg border-t-4 shadow-sm p-4 flex flex-col gap-3"
    :class="headerColor === 'blue' ? 'border-blue-500' : 'border-violet-500'"
  >
    <div
      class="text-xs font-bold tracking-widest uppercase"
      :class="headerColor === 'blue' ? 'text-blue-500' : 'text-violet-500'"
    >
      {{ title }}
    </div>

    <div v-if="result">
      <!-- Wikidata -->
      <div :class="!showMismatchHighlight.wikidata ? 'bg-red-50 rounded p-2 -mx-1' : ''">
        <div class="text-xs text-surface-400 mb-1">Wikidata</div>
        <a
          :href="`https://www.wikidata.org/wiki/${result.wikidata}`"
          target="_blank"
          class="text-sm text-surface-800 hover:text-blue-600"
        >
          {{ result.wikidata }} ↗
        </a>
      </div>

      <!-- Commons -->
      <div
        :class="!showMismatchHighlight.commons ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'"
      >
        <div class="text-xs text-surface-400 mb-1">Commons</div>
        <a
          :href="result.commons_cat.url"
          target="_blank"
          class="text-sm text-surface-800 hover:text-blue-600"
        >
          {{ result.commons_cat.title }} ↗
        </a>
      </div>

      <!-- Admin level -->
      <div
        :class="!showMismatchHighlight.adminLevel ? 'bg-red-50 rounded p-2 -mx-1 mt-2' : 'mt-2'"
      >
        <div class="text-xs text-surface-400 mb-1">Admin level</div>
        <div class="text-sm text-surface-800">{{ result.admin_level }}</div>
      </div>
    </div>

    <div v-else class="text-sm text-surface-400">No result</div>
  </div>
</template>
