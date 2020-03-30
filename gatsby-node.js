/**
 * Implement Gatsby's Node APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/node-apis/
 */

const path = require(`path`)
const _ = require('lodash')
const cheerio = require('cheerio')

const query = `
{
  allMarkdownRemark(limit: 1000) {
    edges {
      node {
        frontmatter {
          path
          collectionKey
          collectionIndex
          collectionMerge
          navText
        }
        html
      }
    }
  }
}
`

const setTableColumnWidths = nodes => {
  return nodes.map(node => {
    const $ = cheerio.load(node.html)
    const regex = /\[\d*\]/g // match [25] format for column width

    $('table tbody tr:first-child').each(function() {
      const row = $(this)
      if (regex.test(row.find('td').text())) {
        const columnWidths = row
          .find('td')
          .text()
          .split('][')
          .map(segment => segment.replace('[', '').replace(']', '')) // strip remaining brackets

        const th = $(this)
          .closest('table')
          .find('th')
        const td = $(this)
          .next()
          .find('td')
        const cells = th.length ? th : td

        cells.map(function(i) {
          $(this).attr('style', `width: ${columnWidths[i]}%;`)
          return $(this)
        })

        // delete this row
        row.remove()
      }
    })

    node.html = $.html()
    return node
  })
}

const createTableOfContents = $ => {
  const toc = $('h2')
    .map(function() {
      const el = $(this)
      const href = el.find('.anchor').attr('href')
      const className = `level-${el.prop('tagName')}`

      return `<li><a href="${href}" class="${className}">${el.text()}</a></li>`
    })
    .get()
    .join(' ')

  return `<ul>${toc}</ul>`
}

const section = ($, isPage) => {
  return `
    <section>
      <div class="toc">
        <div class="toc-sticky">
          <h6>${isPage ? 'On this Page' : 'In this Section'}:</h6>
          ${createTableOfContents($)}
          </div>
      </div>
      ${$.html()}
    </section>
  `
}

const createGroups = nodes => {
  const groups = []

  // group related pages by collectionKey
  nodes.forEach(n => {
    const { collectionMerge, collectionKey } = n.frontmatter

    if (collectionMerge === true && !groups[collectionKey]) {
      groups.push({
        key: collectionKey,
        nodes: nodes
          .filter(node => collectionKey === node.frontmatter.collectionKey)
          .sort((a, b) => a.frontmatter.collectionIndex - b.frontmatter.collectionIndex),
      })
    }
  })

  return groups
}

const mergeGroups = nodes => {
  return nodes
    .map((node, i) => {
      const $ = cheerio.load(node.html)
      const fragment =
        i === 0
          ? '' // first header doesn't need a redundant hash
          : node.frontmatter.path.replace(
              /\//g, // remove slashes
              ''
            )

      // TODO error if <h1> is not the first child, verify fragment is unique
      // replace fragments generated by autolink plugin with the path from the markdown file
      $('h1')
        .first()
        .attr('id', fragment)
        .addClass('section-anchor')
        .find('a')
        .attr('href', `#${fragment}`)

      // content of each markdown file gets its own section
      return section($)
    })
    .join('')
}

exports.createPages = async ({ actions, graphql, reporter }) => {
  const { createPage } = actions
  const result = await graphql(query)

  // Handle errors
  if (result.errors) {
    reporter.panicOnBuild(`Error while running GraphQL query.`)
    return
  }

  const nodes = setTableColumnWidths(result.data.allMarkdownRemark.edges.map(e => e.node))
  const groups = createGroups(nodes)

  // start with single pages
  let pages = _.difference(nodes, _.flatten(groups.map(g => g.nodes))).map(n => {
    const $ = cheerio.load(n.html)

    n.html = section($, true)
    return n
  })

  groups.forEach(group => {
    // overwrite the first node's html with concatenated html from all nodes in the group
    group.nodes[0].html = mergeGroups(group.nodes)
    pages = [...pages, group.nodes[0]] // add merged page to the collection of pages
  })

  pages.forEach(({ frontmatter, html }) => {
    createPage({
      path: frontmatter.path,
      component: path.resolve(`src/templates/page.js`),
      context: {
        html,
      },
    })
  })
}
