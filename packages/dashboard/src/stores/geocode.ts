import type { App } from '@backend/index'
import type { GeocodeCompareResponse } from '@backend/types/geocode.types'
import { treaty } from '@elysiajs/eden'
import { defineStore } from 'pinia'
import { ref } from 'vue'

const client = treaty<App>('')

export const useGeocodeStore = defineStore('geocode', () => {
  const compareResult = ref<GeocodeCompareResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function compareGeocode(lat: number, lon: number): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const response = await client.geocode.compare.get({ query: { lat, lon } })
      if (response.data) {
        compareResult.value = response.data
      }
    } catch (e) {
      console.error('Failed to compare geocode', e)
      error.value = 'Failed to compare geocode'
    } finally {
      loading.value = false
    }
  }

  return { compareResult, loading, error, compareGeocode }
})
