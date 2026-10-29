<script setup lang="ts">
import type { DocumentCardData } from '~/utils/documentBadges'
import DocumentCardBody from './DocumentCardBody.vue'

// 共通ドキュメントカード (Refs #69)。
// ダッシュボード一覧で使う rich カード。本体 (タイトル / 概要 / バッジ) は DocumentCardBody。
//
// アクション (マスク / 非表示 / 削除 / ダウンロード等) は呼び出し元固有なので
// `#actions` slot に委ねる。カード本体クリックの遷移先は `to` prop。
// DocumentCardData 型は ~/utils/documentBadges で single-source。
//
// リンクは `<NuxtLink>` をタグで書く (Nuxt が compile 時に解決する)。#82 から template の式で
// `resolveComponent('NuxtLink')` を呼んでいたため解決されず、`<nuxtlink>` という生の要素が描かれて
// カードがリンクにならなかった。

withDefaults(
  defineProps<{
    doc: DocumentCardData
    /** カード本体クリックの遷移先。未指定ならリンクにしない (div 描画)。 */
    to?: string | null
    /** 非表示中など薄く表示したいとき。 */
    dimmed?: boolean
  }>(),
  { to: null, dimmed: false },
)
</script>

<template>
  <div
    :class="[
      'bg-white rounded-lg shadow border hover:bg-gray-50 transition',
      dimmed ? 'opacity-60' : '',
    ]"
  >
    <NuxtLink v-if="to" :to="to" class="block p-4">
      <DocumentCardBody :doc="doc" />
    </NuxtLink>
    <div v-else class="block p-4">
      <DocumentCardBody :doc="doc" />
    </div>

    <div v-if="$slots.actions" class="px-4 pb-3 -mt-1 flex items-center gap-2 flex-wrap">
      <slot name="actions" />
    </div>
  </div>
</template>
