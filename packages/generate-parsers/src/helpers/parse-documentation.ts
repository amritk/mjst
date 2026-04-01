type PropertyDocumentation = {
  description: string
  isRequired: boolean
}

export type ObjectDocumentation = {
  title: string
  description: string
  properties: Record<string, PropertyDocumentation>
}

/**
 * Fetches and parses OpenAPI specification documentation from the markdown source.
 *
 * When a section has no Fixed Fields table (e.g. Header Object delegates to Parameter Object),
 * pass `fallbackCommentUrl` to inherit property documentation from another section.
 */
export const parseDocumentation = (
  markdownDocumentation: string,
  commentUrl: string,
  fallbackCommentUrl?: string,
): ObjectDocumentation | null => {
  try {
    const markdown = markdownDocumentation

    // Extract the fragment ID from the URL (e.g., #info-object)
    const fragmentId = commentUrl.split('#')[1]
    if (!fragmentId) {
      return null
    }

    // Extract the base URL (everything before the #)
    const baseUrl = commentUrl.split('#')[0]

    // Convert fragment ID to title case (e.g., "info-object" -> "Info Object")
    const titleWords = fragmentId.split('-')
    let sectionTitle = ''
    for (let i = 0; i < titleWords.length; i++) {
      if (i > 0) sectionTitle += ' '
      const word = titleWords[i] ?? ''
      sectionTitle += word.charAt(0).toUpperCase() + word.slice(1)
    }

    // Find the section in the markdown
    // Match the section heading and capture everything until the next #### heading or end of file
    const sectionRegex = new RegExp(`####\\s+${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n####\\s|$)`, 'i')
    const sectionMatch = markdown.match(sectionRegex)

    if (!sectionMatch) {
      return null
    }

    const sectionContent = sectionMatch?.[1]

    if (!sectionContent) {
      return null
    }

    // Extract the description (paragraphs before "##### Fixed Fields")
    // \n? handles the case where sectionContent starts directly with "#####" (no leading newline),
    // which happens when the section heading is followed by a blank line consumed by \s* in sectionRegex.
    const descriptionMatch = sectionContent.match(/^([\s\S]*?)(?=\n?#####|$)/)
    const description = descriptionMatch?.[1]?.trim().replace(/\n/g, ' ') || ''

    // Extract the Fixed Fields table
    const tableRegex = /##### Fixed Fields\s*\n([\s\S]*?)(?=\n#####|This object MAY be extended|$)/
    const tableMatch = sectionContent.match(tableRegex)

    const properties: Record<string, PropertyDocumentation> = {}

    if (tableMatch?.[1]) {
      const tableContent = tableMatch[1]

      // Parse markdown table rows
      const lines = tableContent.split('\n')
      let inTable = false

      for (const line of lines) {
        // Skip the header row and separator row
        if (line.includes('Field Name') || line.includes('---|')) {
          inTable = true
          continue
        }

        if (!inTable || !line.trim() || !line.includes('|')) {
          continue
        }

        // Parse table row: | fieldName | type | description |
        // First, replace escaped pipes (\|) with a placeholder to avoid splitting on them
        const lineWithPlaceholder = line.replace(/\\\|/g, '___PIPE___')
        const cells = lineWithPlaceholder
          .split('|')
          .map((cell) => cell.replace(/___PIPE___/g, '|').trim())
          .filter((cell) => cell)

        if (cells.length >= 3) {
          const fieldName = cells[0]?.replace(/<[^>]*>/g, '').trim() // Remove HTML tags
          // Some OpenAPI tables include an "Applies To" column before Description.
          // We always want the right-most column as the property description.
          const descriptionCellIndex = cells.length >= 4 ? 3 : 2
          let fieldDescription = cells[descriptionCellIndex]?.trim() || ''
          const isRequired = fieldDescription.includes('REQUIRED')

          // Replace relative anchor links with full URLs using the base URL
          fieldDescription = fieldDescription.replace(/\(#([^)]+)\)/g, `(${baseUrl}#$1)`)

          if (fieldName && !fieldName.includes('Field Name')) {
            properties[fieldName] = {
              description: fieldDescription,
              isRequired,
            }
          }
        }
      }
    }

    // Format title as "Info object" instead of "Info Object"
    const title = sectionTitle.replace(/\sObject$/, ' object')

    // If no properties were found and a fallback URL is provided, inherit properties from it
    if (Object.keys(properties).length === 0 && fallbackCommentUrl) {
      const fallback = parseDocumentation(markdownDocumentation, fallbackCommentUrl)
      if (fallback && Object.keys(fallback.properties).length > 0) {
        return {
          title,
          description,
          properties: fallback.properties,
        }
      }
    }

    return {
      title,
      description,
      properties,
    }
  } catch (error) {
    console.error('Failed to fetch OpenAPI documentation:', error)
    return null
  }
}
