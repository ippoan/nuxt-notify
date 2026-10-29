// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import DocumentCard from '../../app/components/DocumentCard.vue'

// Nuxt の NuxtLink の代わり (to を href に持つ <a>)。本物は Nuxt が compile 時に <NuxtLink> のタグを解決する
const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('a', { href: props.to, 'data-nuxt-link': '' }, slots.default?.())
  },
})

const doc = {
  id: 'd1',
  file_name: '配車.pdf',
  extracted_title: '配車依頼',
  created_at: '2026-10-01T00:00:00Z',
  redaction_status: 'completed',
  redactions_applied: 2,
  extraction_status: 'completed',
  distribution_status: 'pending',
}

async function mount(props: Record<string, unknown>) {
  const el = document.createElement('div')
  const app = createApp(DocumentCard, props)
  app.component('NuxtLink', NuxtLinkStub)
  app.mount(el)
  await nextTick()
  return { el, unmount: () => app.unmount() }
}

describe('DocumentCard', () => {
  it('to があればカード本体が詳細へのリンク (<a href>) になる (生の <nuxtlink> を描かない)', async () => {
    const { el, unmount } = await mount({ doc, to: '/documents/d1' })
    const link = el.querySelector('a[data-nuxt-link]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/documents/d1')
    expect(link!.textContent).toContain('配車依頼')
    expect(el.innerHTML.toLowerCase()).not.toContain('<nuxtlink')
    unmount()
  })

  it('to が無ければリンクにしない (div)', async () => {
    const { el, unmount } = await mount({ doc })
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('配車依頼')
    expect(el.innerHTML.toLowerCase()).not.toContain('nuxtlink')
    unmount()
  })
})
