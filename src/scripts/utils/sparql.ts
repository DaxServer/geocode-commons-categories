/**
 * Wikimedia Commons API utilities for validating category existence
 */

const USER_AGENT =
  'Wikimedia Commons / User:DaxServer / geocode-commons-categories/1.0 (https://github.com/DaxServer/geocode-commons-categories)'

/**
 * Validate Commons category existence via Wikimedia Commons API
 */
export async function validateCommonsCategory(category: string): Promise<boolean> {
  const encodedCategory = encodeURIComponent(`Category:${category}`)
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodedCategory}&format=json`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    })
    const data = (await response.json()) as { query?: { pages?: Record<string, unknown> } }

    if (!data.query?.pages) {
      return false
    }

    const pages = data.query.pages
    const pageId = Object.keys(pages)[0]

    // Page ID -1 means the page doesn't exist
    return pageId !== '-1'
  } catch (error) {
    console.warn(`Failed to validate Commons category ${category}:`, error)
    return false // Assume invalid on error
  }
}

/**
 * Batch validate Commons categories (with rate limiting)
 */
export async function batchValidateCommonsCategories(
  categories: string[],
  batchSize = 50,
): Promise<Set<string>> {
  const validCategories = new Set<string>()

  for (let i = 0; i < categories.length; i += batchSize) {
    const batch = categories.slice(i, i + batchSize)
    console.log(`Validating batch ${i / batchSize + 1}/${Math.ceil(categories.length / batchSize)}`)

    await Promise.all(
      batch.map(async (category) => {
        const isValid = await validateCommonsCategory(category)
        if (isValid) {
          validCategories.add(category)
        }
      }),
    )

    // Rate limiting delay between batches
    if (i + batchSize < categories.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return validCategories
}
