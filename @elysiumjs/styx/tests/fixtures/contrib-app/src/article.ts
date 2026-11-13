// Copyright (c) 2026-present Axel Nana <ax.lnana@outlook.com>. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Http, t, View } from '@elysiumjs/olympus';

type Article = { id: string; title: string; publishedAt: Date };

/** How an article is shown. */
export class ArticleView extends View(
	t.Object({ id: t.String(), title: t.String(), publishedAt: t.String({ format: 'date-time' }) })
) {
	public static override render(article: Article) {
		return { id: article.id, title: article.title, publishedAt: article.publishedAt };
	}
}

const article = (): Article => ({ id: '1', title: 'Hello', publishedAt: new Date() });

@Http.controller('/articles')
export class ArticleController {
	@Http.get('/:id', { response: ArticleView })
	public show(): Article {
		return article();
	}

	@Http.get('/', { response: ArticleView.list })
	public list(): Article[] {
		return [article()];
	}

	@Http.get('/page', { response: ArticleView.page })
	public page(@Http.query(t.Object({ page: t.Optional(t.String()) })) _query: unknown) {
		return { data: [article()], page: 1, limit: 20, total: 1 };
	}
}
