import { MetadataRoute } from 'next'
 
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Log It',
    short_name: 'Log It',
    description: 'Aviation Fleet Tracker Companion App',
    start_url: '/quick',
    display: 'standalone', // Hides the browser URL bar for native feel
    background_color: '#3AB0FF',
    theme_color: '#3AB0FF',
    icons:[
      {
        src: '/quick-icon.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}