<script setup lang="ts">
import maplibregl from 'maplibre-gl'
import { onMounted, ref } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGeocodeStore } from '@frontend/stores/geocode'

const store = useGeocodeStore()
const mapContainer = ref<HTMLDivElement | null>(null)

onMounted(() => {
  if (!mapContainer.value) return

  const map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
    center: [0, 20],
    zoom: 2,
  })

  map.addControl(new maplibregl.NavigationControl())

  map.on('click', (e) => {
    store.compareGeocode(e.lngLat.lat, e.lngLat.lng)
  })
})
</script>

<template>
  <div class="flex flex-col h-screen">
    <div ref="mapContainer" class="h-[35vh] w-full" />
    <ComparePanel />
  </div>
</template>
