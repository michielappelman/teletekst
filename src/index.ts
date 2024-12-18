type NewsItem = {
	title: string;
	text: string;
	category: string;
};

async function getTT(page: number): Promise<any> {
	const ttRequest = await fetch(`https://teletekst-data.nos.nl/json/${page}`);
	if (!ttRequest.ok) {
		throw new Error('Pagina niet gevonden');
	}
	return ttRequest.json();
}

function fixText(lines: string[]): string {
	if (lines.length > 0 && lines[lines.length - 1].includes('sport')) {
		lines.pop();
	}
	let joinedString = lines.join(' ');
	joinedString = joinedString.replace(/,(?=[^\s])/g, ', ');
	joinedString = joinedString.replace(/:(?=[^\s])/g, ': ');
	joinedString = joinedString.replace(/\.(?=[A-Z])/g, '. ');
	return joinedString;
}

class TextHandler {
	content: string[] = [];

	text = (text: { text: string }) => {
		if (text.text.trim()) {
			this.content.push(text.text.trim());
		}
	};
}

async function processPage(pageNumber: number, category: string): Promise<NewsItem> {
	const titleHandler = new TextHandler();
	const textHandler = new TextHandler();
	const rewriter = new HTMLRewriter().on('span.yellow.bg-blue', titleHandler).on('span.cyan', textHandler);

	const ttPage = await getTT(pageNumber);
	const response = new Response(ttPage.content);

	await rewriter.transform(response).text();

	return {
		title: fixText(titleHandler.content),
		text: fixText(textHandler.content),
		category: category,
	};
}

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
		// Retrieve all news items from the KV store
		const data = await env.KV.get('news-items');
		if (!data) {
			return new Response('No news items found', { status: 404 });
		}

		const newsItems: NewsItem[] = JSON.parse(data);

		// Generate HTML content
		const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Latest News</title>
          <style>
              :root {
                  --color-background: #fcfcfa;
                  --color-text: #444444;
              }
              @media (prefers-color-scheme: dark) {
                  :root {
                      --color-background: #444444;
                      --color-text: #f9f9f9;
                  }
              }
              body {
                  background: var(--color-background);
                  margin: 10px auto;
                  max-width: 650px;
                  text-align: justify;
                  line-height: 1.5;
                  font-size: 18px;
                  color: var(--color-text);
                  padding: 15pt;
              }
              h1, h2 {
                  text-align: left;
                  line-height: 1.2;
              }
							h2:first-letter {
									text-transform: uppercase;
							}
              .news-item {
                  margin-bottom: 20px;
              }
              .news-content {
                  display: none;
                  margin-top: 5px;
              }
              a {
                  border-bottom: 1px solid var(--color-text);
                  color: var(--color-text);
                  text-decoration: none;
                  cursor: pointer;
              }
              a:hover {
                  border-bottom: 0;
              }
              footer {
                  text-align: center;
                  font-size: 14px;
              }
          </style>
      </head>
      <body>

      <h1>NOS Nieuws</h1>
      ${Object.entries(
			newsItems.reduce((acc: Record<string, NewsItem[]>, item) => {
				if (!acc[item.category]) {
					acc[item.category] = [];
				}
				acc[item.category].push(item);
				return acc;
			}, {}),
		)
				.map(
					([category, items]) => `
        <section>
          <h2>${category}</h2>
          <div id="news-container">
            ${items
							.map(
								(item, index) => `
              <div class="news-item">
                <a class="news-title" onclick="toggleContent('${category}-${index}')">${item.title}</a>
                <div id="${category}-${index}" class="news-content">${item.text}</div>
              </div>
            `,
							)
							.join('')}
          </div>
        </section>
      `,
				)
				.join('')}

      <footer>
        <p>&copy; 2024 NOS</p>
      </footer>

      <script>
        function toggleContent(id) {
          const contentDiv = document.getElementById(id);
          if (contentDiv) {
            contentDiv.style.display = contentDiv.style.display === 'block' ? 'none' : 'block';
          }
        }
      </script>

      </body>
      </html>
    `;

		return new Response(htmlContent, {
			headers: { 'Content-Type': 'text/html' },
		});
	},

	async scheduled(event: ScheduledEvent, env: any): Promise<void> {
		const pagesToGet: Record<string, number[]> = {
			binnenland: [104, 105, 106, 107, 108, 109, 110, 111],
			buitenland: [125, 126, 127, 128, 129, 130, 131, 132],
		};

		const allNewsItems: NewsItem[] = [];

		for (const category in pagesToGet) {
			if (pagesToGet.hasOwnProperty(category)) {
				const pages = pagesToGet[category];
				for (const pageNumber of pages) {
					try {
						const newsItem = await processPage(pageNumber, category);
						console.log(`Processing '${newsItem.title}'`);
						allNewsItems.push(newsItem);
					} catch (e) {
						console.error(`Error processing page ${pageNumber}: ${e instanceof Error ? e.message : e}`);
					}
				}
			}
		}

		await env.KV.put('news-items', JSON.stringify(allNewsItems));
		console.log(`Stored ${allNewsItems.length} news items.`);
	},
};
