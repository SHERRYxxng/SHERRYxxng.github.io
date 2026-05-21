/**
 * LocalSearch - Optimized with inverted index
 * Refer to hexo-generator-searchdb
 * https://github.com/next-theme/hexo-generator-searchdb/blob/main/dist/search.js
 * Modified by hexo-theme-butterfly
 *
 * Performance optimizations:
 * - Inverted index for O(1) term lookup instead of O(n) full-text scan
 * - CJK: unigrams + bigrams tokenization
 * - English: whole-word tokenization (min 2 chars)
 * - 300ms debounce on input
 * - Result limit (50) with early termination
 */

class LocalSearch {
  constructor ({
    path = '',
    unescape = false,
    top_n_per_article = 1
  }) {
    this.path = path
    this.unescape = unescape
    this.top_n_per_article = top_n_per_article
    this.isfetched = false
    this.datas = null
    this.invertedIndex = null
  }

  // Tokenize text into searchable terms
  // CJK text → unigrams + bigrams; ASCII → whole words (≥ 2 chars)
  tokenize (text) {
    const terms = new Set()
    if (!text) return [...terms]
    const lower = text.toLowerCase()
    let i = 0
    while (i < lower.length) {
      const ch = lower[i]
      if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) {
        const start = i
        while (i < lower.length && /[一-鿿㐀-䶿豈-﫿]/.test(lower[i])) i++
        const run = lower.substring(start, i)
        for (let j = 0; j < run.length; j++) {
          terms.add(run[j])
          if (j < run.length - 1) terms.add(run.substring(j, j + 2))
        }
      } else if (/[a-z0-9]/.test(ch)) {
        const start = i
        while (i < lower.length && /[a-z0-9]/.test(lower[i])) i++
        const word = lower.substring(start, i)
        if (word.length >= 2) terms.add(word)
      } else {
        i++
      }
    }
    return [...terms]
  }

  getIndexByWord (words, text, caseSensitive = false) {
    const index = []
    const included = new Set()

    if (!caseSensitive) {
      text = text.toLowerCase()
    }
    words.forEach(word => {
      if (this.unescape) {
        const div = document.createElement('div')
        div.innerText = word
        word = div.innerHTML
      }
      const wordLen = word.length
      if (wordLen === 0) return
      let startPosition = 0
      let position = -1
      if (!caseSensitive) {
        word = word.toLowerCase()
      }
      while ((position = text.indexOf(word, startPosition)) > -1) {
        index.push({ position, word })
        included.add(word)
        startPosition = position + wordLen
      }
    })
    index.sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position
      }
      return right.word.length - left.word.length
    })
    return [index, included]
  }

  // Merge hits into slices
  mergeIntoSlice (start, end, index, startIdx) {
    let i = startIdx
    let item = index[i]
    let { position, word } = item
    const hits = []
    const count = new Set()
    while (i < index.length && position + word.length <= end) {
      count.add(word)
      hits.push({
        position,
        length: word.length
      })
      const wordEnd = position + word.length

      i++
      while (i < index.length) {
        item = index[i]
        position = item.position
        word = item.word
        if (wordEnd > position) {
          i++
        } else {
          break
        }
      }
    }
    return {
      hits,
      start,
      end,
      count: count.size,
      nextIdx: i
    }
  }

  // Highlight title and content
  highlightKeyword (val, slice) {
    let result = ''
    let index = slice.start
    for (const { position, length } of slice.hits) {
      result += val.substring(index, position)
      index = position + length
      result += `<mark class="search-keyword">${val.substr(position, length)}</mark>`
    }
    result += val.substring(index, slice.end)
    return result
  }

  // Build inverted index from loaded data
  buildIndex () {
    this.invertedIndex = new Map()
    this.datas.forEach((data, articleIdx) => {
      const text = data.title + ' ' + data.content
      const terms = this.tokenize(text)
      terms.forEach(term => {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, new Set())
        }
        this.invertedIndex.get(term).add(articleIdx)
      })
    })
  }

  // Find candidate articles using inverted index
  // Returns Set of article indices, or null if index should be bypassed
  queryIndex (keywords) {
    if (!this.invertedIndex) return null

    const queryTerms = new Set()
    keywords.forEach(kw => {
      if (!kw) return
      this.tokenize(kw).forEach(t => queryTerms.add(t))
    })
    if (queryTerms.size === 0) return null

    // For each query term, find matching articles
    let candidates = null
    let foundAny = false
    for (const term of queryTerms) {
      const matches = this.invertedIndex.get(term)
      if (!matches) continue
      foundAny = true
      if (candidates === null) {
        candidates = new Set(matches)
      } else {
        for (const id of candidates) {
          if (!matches.has(id)) candidates.delete(id)
        }
      }
      if (candidates.size === 0) break
    }

    if (!foundAny) return null
    return candidates || new Set()
  }

  // Fallback: substring search using includes()
  // Used when inverted index doesn't have the query terms
  fallbackSearch (keywords, maxResults) {
    const resultIndices = []
    const lowerKeywords = keywords.filter(Boolean).map(k => k.toLowerCase())
    if (lowerKeywords.length === 0) return resultIndices

    for (let i = 0; i < this.datas.length && resultIndices.length < maxResults; i++) {
      const data = this.datas[i]
      const title = data.title.toLowerCase()
      const content = data.content.toLowerCase()
      if (lowerKeywords.some(kw => title.includes(kw) || content.includes(kw))) {
        resultIndices.push(i)
      }
    }
    return resultIndices
  }

  getResultItems (keywords) {
    const resultItems = []
    const MAX_RESULTS = 50

    // Try inverted index first
    let candidateIndices = this.queryIndex(keywords)

    // Fallback to substring search if index didn't help
    if (candidateIndices === null) {
      const fallbackIds = this.fallbackSearch(keywords, MAX_RESULTS)
      if (fallbackIds.length === 0) return resultItems
      candidateIndices = new Set(fallbackIds)
    }

    if (candidateIndices.size === 0) return resultItems

    // Score and process candidates
    const scored = []
    for (const idx of candidateIndices) {
      if (scored.length >= MAX_RESULTS) break
      const { title, content, url } = this.datas[idx]

      const [indexOfTitle, keysOfTitle] = this.getIndexByWord(keywords, title)
      const [indexOfContent, keysOfContent] = this.getIndexByWord(keywords, content)
      const includedCount = new Set([...keysOfTitle, ...keysOfContent]).size
      const hitCount = indexOfTitle.length + indexOfContent.length

      if (hitCount === 0) continue

      // Score: title matches weighted 10x
      const score = indexOfTitle.length * 10 + indexOfContent.length

      const slicesOfTitle = []
      if (indexOfTitle.length !== 0) {
        slicesOfTitle.push(this.mergeIntoSlice(0, title.length, indexOfTitle, 0))
      }

      let slicesOfContent = []
      let idxPtr = 0
      while (idxPtr < indexOfContent.length) {
        const item = indexOfContent[idxPtr]
        const { position } = item
        const start = Math.max(0, position - 20)
        const end = Math.min(content.length, position + 100)
        const slice = this.mergeIntoSlice(start, end, indexOfContent, idxPtr)
        slicesOfContent.push(slice)
        idxPtr = slice.nextIdx
      }

      slicesOfContent.sort((left, right) => {
        if (left.count !== right.count) return right.count - left.count
        if (left.hits.length !== right.hits.length) return right.hits.length - left.hits.length
        return left.start - right.start
      })

      const upperBound = parseInt(this.top_n_per_article, 10)
      if (upperBound >= 0) {
        slicesOfContent = slicesOfContent.slice(0, upperBound)
      }

      let resultItem = ''
      const articleUrl = new URL(url, location.origin)
      articleUrl.searchParams.append('highlight', keywords.join(' '))

      if (slicesOfTitle.length !== 0) {
        resultItem += `<li class="local-search-hit-item"><a href="${articleUrl.href}"><span class="search-result-title">${this.highlightKeyword(title, slicesOfTitle[0])}</span>`
      } else {
        resultItem += `<li class="local-search-hit-item"><a href="${articleUrl.href}"><span class="search-result-title">${title}</span>`
      }

      slicesOfContent.forEach(slice => {
        resultItem += `<p class="search-result">${this.highlightKeyword(content, slice)}...</p>`
      })

      resultItem += '</a></li>'
      scored.push({
        item: resultItem,
        id: 0, // will be reassigned after sort
        hitCount,
        includedCount,
        score
      })
    }

    // Sort by score descending (title-heavy), then by hit count
    scored.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.includedCount !== right.includedCount) return right.includedCount - left.includedCount
      return right.hitCount - left.hitCount
    })

    return scored.slice(0, MAX_RESULTS).map((item, index) => {
      item.id = index
      return item
    })
  }

  fetchData () {
    const isJson = this.path.endsWith('json')
    fetch(this.path)
      .then(response => response.text())
      .then(res => {
        this.isfetched = true
        if (isJson) {
          this.datas = JSON.parse(res)
        } else {
          this.datas = [...new DOMParser().parseFromString(res, 'text/xml').querySelectorAll('entry')].map(element => ({
            title: element.querySelector('title').textContent,
            content: element.querySelector('content').textContent,
            url: element.querySelector('url').textContent
          }))
        }
        this.datas = this.datas.filter(data => data.title).map(data => {
          data.title = data.title.trim()
          data.content = data.content ? data.content.trim().replace(/<[^>]+>/g, '') : ''
          data.url = decodeURIComponent(data.url).replace(/\/{2,}/g, '/')
          return data
        })
        // Build inverted index for instant search
        this.buildIndex()
        window.dispatchEvent(new Event('search:loaded'))
      })
  }

  // Highlight by wrapping node in mark elements with the given class name
  highlightText (node, slice, className) {
    const val = node.nodeValue
    let index = slice.start
    const children = []
    for (const { position, length } of slice.hits) {
      const text = document.createTextNode(val.substring(index, position))
      index = position + length
      const mark = document.createElement('mark')
      mark.className = className
      mark.appendChild(document.createTextNode(val.substr(position, length)))
      children.push(text, mark)
    }
    node.nodeValue = val.substring(index, slice.end)
    children.forEach(element => {
      node.parentNode.insertBefore(element, node)
    })
  }

  // Highlight the search words provided in the url in the text
  highlightSearchWords (body) {
    const params = new URL(location.href).searchParams.get('highlight')
    const keywords = params ? params.split(' ') : []
    if (!keywords.length || !body) return
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
    const allNodes = []
    while (walk.nextNode()) {
      if (!walk.currentNode.parentNode.matches('button, select, textarea, .mermaid')) allNodes.push(walk.currentNode)
    }
    allNodes.forEach(node => {
      const [indexOfNode] = this.getIndexByWord(keywords, node.nodeValue)
      if (!indexOfNode.length) return
      const slice = this.mergeIntoSlice(0, node.nodeValue.length, indexOfNode, 0)
      this.highlightText(node, slice, 'search-keyword')
    })
  }
}

window.addEventListener('load', () => {
  const { path, top_n_per_article, unescape, languages, pagination } = GLOBAL_CONFIG.localSearch
  const enablePagination = pagination && pagination.enable
  const localSearch = new LocalSearch({
    path,
    top_n_per_article,
    unescape
  })

  const input = document.querySelector('.local-search-input input')
  const statsItem = document.getElementById('local-search-stats')
  const $loadingStatus = document.getElementById('loading-status')

  let currentPage = 0
  const hitsPerPage = pagination.hitsPerPage || 10
  let currentResultItems = []

  if (!enablePagination) {
    currentPage = undefined
    currentResultItems = undefined
  }

  const elements = {
    get pagination () { return document.getElementById('local-search-pagination') },
    get paginationList () { return document.querySelector('#local-search-pagination .ais-Pagination-list') }
  }

  const toggleResultsVisibility = hasResults => {
    if (enablePagination) {
      elements.pagination.style.display = hasResults ? '' : 'none'
    } else {
      elements.pagination.style.display = 'none'
    }
  }

  const renderResults = (searchText, resultItems) => {
    const container = document.getElementById('local-search-results')

    const itemsToDisplay = enablePagination
      ? currentResultItems.slice(currentPage * hitsPerPage, (currentPage + 1) * hitsPerPage)
      : resultItems

    if (enablePagination && itemsToDisplay.length === 0 && currentResultItems.length > 0) {
      currentPage = 0
      renderResults(searchText, resultItems)
      return
    }

    const numberedItems = itemsToDisplay.map((result, index) => {
      const itemNumber = enablePagination
        ? currentPage * hitsPerPage + index + 1
        : index + 1
      return result.item.replace(
        '<li class="local-search-hit-item">',
        `<li class="local-search-hit-item" value="${itemNumber}">`
      )
    })

    container.innerHTML = `<ol class="search-result-list">${numberedItems.join('')}</ol>`

    const displayCount = enablePagination ? currentResultItems.length : resultItems.length
    const stats = languages.hits_stats.replace(/\$\{hits}/, displayCount)
    statsItem.innerHTML = `<hr><div class="search-result-stats">${stats}</div>`

    if (enablePagination) {
      const nbPages = Math.ceil(currentResultItems.length / hitsPerPage)
      renderPagination(currentPage, nbPages, searchText)
    }

    const hasResults = resultItems.length > 0
    toggleResultsVisibility(hasResults)

    window.pjax && window.pjax.refresh(container)
  }

  const renderPagination = (page, nbPages, query) => {
    if (nbPages <= 1) {
      elements.pagination.style.display = 'none'
      elements.paginationList.innerHTML = ''
      return
    }

    elements.pagination.style.display = 'block'

    const isFirstPage = page === 0
    const isLastPage = page === nbPages - 1
    const isMobile = window.innerWidth < 768
    const maxVisiblePages = isMobile ? 3 : 5
    let startPage = Math.max(0, page - Math.floor(maxVisiblePages / 2))
    const endPage = Math.min(nbPages - 1, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(0, endPage - maxVisiblePages + 1)
    }

    let pagesHTML = ''

    if (nbPages > maxVisiblePages && startPage > 0) {
      pagesHTML += `
        <li class="ais-Pagination-item ais-Pagination-item--page">
          <a class="ais-Pagination-link" aria-label="Page 1" href="#" data-page="0">1</a>
        </li>`
      if (startPage > 1) {
        pagesHTML += `
          <li class="ais-Pagination-item ais-Pagination-item--ellipsis">
            <span class="ais-Pagination-link">...</span>
          </li>`
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      const isSelected = i === page
      if (isSelected) {
        pagesHTML += `
          <li class="ais-Pagination-item ais-Pagination-item--page ais-Pagination-item--selected">
            <span class="ais-Pagination-link" aria-label="Page ${i + 1}">${i + 1}</span>
          </li>`
      } else {
        pagesHTML += `
          <li class="ais-Pagination-item ais-Pagination-item--page">
            <a class="ais-Pagination-link" aria-label="Page ${i + 1}" href="#" data-page="${i}">${i + 1}</a>
          </li>`
      }
    }

    if (nbPages > maxVisiblePages && endPage < nbPages - 1) {
      if (endPage < nbPages - 2) {
        pagesHTML += `
          <li class="ais-Pagination-item ais-Pagination-item--ellipsis">
            <span class="ais-Pagination-link">...</span>
          </li>`
      }
      pagesHTML += `
        <li class="ais-Pagination-item ais-Pagination-item--page">
          <a class="ais-Pagination-link" aria-label="Page ${nbPages}" href="#" data-page="${nbPages - 1}">${nbPages}</a>
        </li>`
    }

    if (nbPages > 1) {
      elements.paginationList.innerHTML = `
            <li class="ais-Pagination-item ais-Pagination-item--previousPage ${isFirstPage ? 'ais-Pagination-item--disabled' : ''}">
              ${isFirstPage
                ? '<span class="ais-Pagination-link ais-Pagination-link--disabled" aria-label="Previous Page"><i class="fas fa-angle-left"></i></span>'
                : `<a class="ais-Pagination-link" aria-label="Previous Page" href="#" data-page="${page - 1}"><i class="fas fa-angle-left"></i></a>`
              }
            </li>
            ${pagesHTML}
            <li class="ais-Pagination-item ais-Pagination-item--nextPage ${isLastPage ? 'ais-Pagination-item--disabled' : ''}">
              ${isLastPage
                ? '<span class="ais-Pagination-link ais-Pagination-link--disabled" aria-label="Next Page"><i class="fas fa-angle-right"></i></span>'
                : `<a class="ais-Pagination-link" aria-label="Next Page" href="#" data-page="${page + 1}"><i class="fas fa-angle-right"></i></a>`
              }
            </li>`
    } else {
      elements.pagination.style.display = 'none'
    }
  }

  const clearSearchResults = () => {
    const container = document.getElementById('local-search-results')
    container.textContent = ''
    statsItem.textContent = ''
    toggleResultsVisibility(false)
    if (enablePagination) {
      currentResultItems = []
      currentPage = 0
    }
  }

  const showNoResults = searchText => {
    const container = document.getElementById('local-search-results')
    container.textContent = ''
    const statsDiv = document.createElement('div')
    statsDiv.className = 'search-result-stats'
    statsDiv.textContent = languages.hits_empty.replace(/\$\{query}/, searchText)
    statsItem.innerHTML = statsDiv.outerHTML
    toggleResultsVisibility(false)
    if (enablePagination) {
      currentResultItems = []
      currentPage = 0
    }
  }

  const inputEventFunction = () => {
    if (!localSearch.isfetched) return
    let searchText = input.value.trim().toLowerCase()
    searchText = searchText.replace(/</g, '&lt;').replace(/>/g, '&gt;')

    if (searchText !== '') $loadingStatus.hidden = false

    const keywords = searchText.split(/[-\s]+/)
    let resultItems = []

    if (searchText.length > 0) {
      resultItems = localSearch.getResultItems(keywords)
    }

    if (keywords.length === 1 && keywords[0] === '') {
      clearSearchResults()
    } else if (resultItems.length === 0) {
      showNoResults(searchText)
    } else {
      if (enablePagination) {
        currentResultItems = resultItems
        currentPage = 0
      }
      renderResults(searchText, resultItems)
    }

    $loadingStatus.hidden = true
  }

  let debounceTimer = null
  const debouncedInputHandler = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(inputEventFunction, 300)
  }

  let loadFlag = false
  const $searchMask = document.getElementById('search-mask')
  const $searchDialog = document.querySelector('#local-search .search-dialog')

  const fixSafariHeight = () => {
    if (window.innerWidth < 768) {
      $searchDialog.style.setProperty('--search-height', window.innerHeight + 'px')
    }
  }

  const openSearch = () => {
    btf.overflowPaddingR.add()
    btf.animateIn($searchMask, 'to_show 0.5s')
    btf.animateIn($searchDialog, 'titleScale 0.5s')
    setTimeout(() => { input.focus() }, 300)
    if (!loadFlag) {
      !localSearch.isfetched && localSearch.fetchData()
      input.addEventListener('input', debouncedInputHandler)
      loadFlag = true
    }
    document.addEventListener('keydown', function f (event) {
      if (event.code === 'Escape') {
        closeSearch()
        document.removeEventListener('keydown', f)
      }
    })

    fixSafariHeight()
    window.addEventListener('resize', fixSafariHeight)
  }

  const closeSearch = () => {
    btf.overflowPaddingR.remove()
    btf.animateOut($searchDialog, 'search_close .5s')
    btf.animateOut($searchMask, 'to_hide 0.5s')
    window.removeEventListener('resize', fixSafariHeight)
  }

  const searchClickFn = () => {
    btf.addEventListenerPjax(document.querySelector('#search-button > .search'), 'click', openSearch)
  }

  const searchFnOnce = () => {
    document.querySelector('#local-search .search-close-button').addEventListener('click', closeSearch)
    $searchMask.addEventListener('click', closeSearch)
    if (GLOBAL_CONFIG.localSearch.preload) {
      localSearch.fetchData()
    }
    localSearch.highlightSearchWords(document.getElementById('article-container'))

    if (enablePagination) {
      elements.pagination.addEventListener('click', e => {
        e.preventDefault()
        const link = e.target.closest('a[data-page]')
        if (link) {
          const page = parseInt(link.dataset.page, 10)
          if (!isNaN(page) && currentResultItems.length > 0) {
            currentPage = page
            renderResults(input.value.trim().toLowerCase(), currentResultItems)
          }
        }
      })
    }

    toggleResultsVisibility(false)
  }

  window.addEventListener('search:loaded', () => {
    const $loadDataItem = document.getElementById('loading-database')
    $loadDataItem.nextElementSibling.style.visibility = 'visible'
    $loadDataItem.remove()
  })

  searchClickFn()
  searchFnOnce()

  window.addEventListener('pjax:complete', () => {
    !btf.isHidden($searchMask) && closeSearch()
    localSearch.highlightSearchWords(document.getElementById('article-container'))
    searchClickFn()
  })
})
