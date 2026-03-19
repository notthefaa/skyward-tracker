import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aircraft Manager',
    short_name: 'Aircraft Manager',
    description: 'Fleet flight logs, maintenance, and squawk tracker.',
    start_url: '/',
    display: 'standalone', // Hides the browser URL bar!
    background_color: '#1B4869',
    theme_color: '#1B4869',
    icons:[
      {
        src: '/icon.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'any', // Fixed TypeScript error here
      },
    ],
  }
}