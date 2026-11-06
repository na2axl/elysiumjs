// Copyright (c) 2025-present Workbud Technologies Inc. All rights reserved.
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

// The `cloudflare:test` module of the workerd lane. Its declarations name the Workers types
// (`ExecutionContext`, `Fetcher`, ...) without importing them; `skipLibCheck` lets them through,
// and the tests use the structural types of `@elysiumjs/runtime-workers` instead.
/// <reference types="@cloudflare/vitest-plugin/types" />
