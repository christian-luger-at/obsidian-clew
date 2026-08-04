import { defineConfig } from 'vitepress'

const repo = 'christian-luger-at/obsidian-clew'

export default defineConfig({
  title: 'Clew',
  description: 'See your whole Obsidian vault as a graph - filter, color, and size notes by your own rules.',
  lang: 'en-US',
  // Project site: served from https://christian-luger-at.github.io/obsidian-clew/
  base: '/obsidian-clew/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://christian-luger-at.github.io/obsidian-clew/' },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/obsidian-clew/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Clew - see your whole Obsidian vault as a graph' }],
    ['meta', { property: 'og:description', content: 'Filter, color, and size the notes in your Obsidian graph by your own rules.' }],
    ['meta', { property: 'og:image', content: 'https://christian-luger-at.github.io/obsidian-clew/screens/graph-overview-dark.png' }],
    ['meta', { property: 'og:url', content: 'https://christian-luger-at.github.io/obsidian-clew/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/faq' },
      { text: 'Releases', link: `https://github.com/${repo}/releases` },
    ],

    // One linear learning path: what the plugin is and how to open it
    // first, then each panel in the order its own toolbar icon appears
    // (Layout, Filter, Color & size, Appearance), then how you interact
    // with the graph itself.
    sidebar: [
      {
        text: 'Introduction',
        items: [{ text: 'What is Clew?', link: '/guide/introduction' }],
      },
      {
        text: 'Using Clew',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Layouts', link: '/guide/layouts' },
          { text: 'Filter', link: '/guide/filter' },
          { text: 'Color & size', link: '/guide/color-and-size' },
          { text: 'Appearance', link: '/guide/appearance' },
          { text: 'Interacting with the graph', link: '/guide/interactions' },
        ],
      },
      {
        text: 'Reference',
        items: [{ text: 'FAQ & troubleshooting', link: '/reference/faq' }],
      },
      {
        text: 'Contributing',
        items: [{ text: 'Development', link: '/guide/development' }],
      },
    ],

    socialLinks: [{ icon: 'github', link: `https://github.com/${repo}` }],

    editLink: {
      pattern: `https://github.com/${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message: 'Released under the 0-BSD License.',
      copyright: '© 2026 Christian Luger',
    },
  },
})
