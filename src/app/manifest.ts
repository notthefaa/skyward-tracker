import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Skyward Aircraft Manager',
    short_name: 'Aircraft Manager',
    description: 'Aircraft fleet management, maintenance tracking, mechanic coordination, and flight logging.',
    start_url: '/',
    display: 'standalone',
    background_color: '#1B4869',
    theme_color: '#1B4869',
    icons:[
      {
        src: '/icon.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}
