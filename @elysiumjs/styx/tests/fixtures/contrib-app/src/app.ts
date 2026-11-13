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

import { Application, Module } from '@elysiumjs/olympus';

import { ArticleController } from './article';
import { GreetingController, makeHealthController } from './greeting';
import { PingRouteTypes } from './pingable';

@Module.register({
	services: [PingRouteTypes],
	controllers: [GreetingController, makeHealthController(), ArticleController]
})
export class PingModule extends Module {}

@Application.register({ modules: [PingModule], openapi: false })
export class ContribApp extends Application {}
