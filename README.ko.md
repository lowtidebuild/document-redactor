# document-redactor

[![CI](https://github.com/lowtidebuild/document-redactor/actions/workflows/ci.yml/badge.svg)](https://github.com/lowtidebuild/document-redactor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lowtidebuild/document-redactor?color=2563eb)](https://github.com/lowtidebuild/document-redactor/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-0f172a.svg)](LICENSE)
[![Bundle](https://img.shields.io/badge/bundle-~180%20KB-16a34a)](https://github.com/lowtidebuild/document-redactor/releases)
[![No network](https://img.shields.io/badge/network-0%20requests-16a34a)](#신뢰의-구조--네트워크-없음의-4단-방어)
[![No AI](https://img.shields.io/badge/AI-none-0f172a)](#이-도구가-무엇이고-무엇이-아닌지)

[![English README](https://img.shields.io/badge/lang-English-2563eb)](README.md)

> **한국어 + 영어 법률 문서를 위한 프라이버시 우선 브라우저 기반 DOCX 마스킹 도구.**
> `.docx` 파일을 드롭합니다. 감지된 개체명과 개인정보를 검토합니다. **Apply and verify** 를 클릭합니다. 마스킹된 사본을 다운로드합니다. 네트워크 요청 0회, 업로드 0회, 계정 0개. 단일 HTML 파일 하나로 모든 최신 브라우저에서 오프라인 실행.

─────────────────────────────────────────────────────────────

## 이 도구가 무엇이고, 무엇이 아닌지

| ✅ 이것입니다 | ❌ 이것이 아닙니다 |
|---|---|
| 브라우저에서 실행되는 오프라인 도구 | 클라우드 서비스 |
| 한 번만 받으면 끝인 단일 HTML 파일 (약 180 KB) | 설치 프로그램이나 네이티브 앱 |
| 규칙 기반의 결정론적(deterministic) 마스킹 도구 | AI 모델 — 모델도, LLM도, "마법"도 없음 |
| 소스를 직접 읽어보고 `sha256sum`으로 검증할 수 있는 도구 | 무조건 믿어야 하는 블랙박스 |
| Apache 2.0 라이선스라 본인 혹은 본인의 AI 어시스턴트가 전체를 감사할 수 있음 | 숨겨진 동작이 있는 독점 소프트웨어 |

누군가 "이거 뒤에서 ChatGPT 쓰는 거 아냐?" 또는 "파일을 어딘가로 보내서 처리하겠지"라고 말한다면 — 틀렸습니다. 이 도구 전체는 디스크 위의 180 KB짜리 JavaScript + CSS + HTML입니다. 텍스트 에디터로 열어볼 수 있고, `fetch`라는 단어를 직접 검색해볼 수도 있습니다. 검색 결과는 0건입니다. 그게 요점입니다.

─────────────────────────────────────────────────────────────

## 빠른 시작

1. **다운로드** — 최신 릴리즈에서 두 파일을 받습니다:
   - [`document-redactor.html`](https://github.com/lowtidebuild/document-redactor/releases/latest/download/document-redactor.html) (도구 자체, 파일 하나)
   - [`document-redactor.html.sha256`](https://github.com/lowtidebuild/document-redactor/releases/latest/download/document-redactor.html.sha256) (무결성 검증용 사이드카 파일)

2. **검증** — 받은 파일이 공개된 원본과 일치하는지 확인합니다:

   ```bash
   sha256sum -c document-redactor.html.sha256
   # 기대 출력:
   #   document-redactor.html: OK
   ```

   `OK` 가 뜨면 파일이 작성자가 배포한 것과 바이트 단위로 완전히 같다는 뜻입니다. 다른 결과가 나오면 **거기서 멈추세요** — GitHub과 당신 사이 어딘가에서 누군가 파일을 바꿔치기했다는 신호입니다. 실행하지 마세요.

3. **열기.** HTML 파일을 더블클릭합니다. 기본 브라우저에서 `file://` URL로 열립니다. 설치 단계 없음, 권한 요청 없음, 네트워크 호출 없음. 그 자리에서 로드된 페이지가 도구의 전부입니다.

4. **사용.** `.docx` 파일을 드롭 영역에 끌어다 놓습니다. 오른쪽 패널에서 감지된 후보들을 검토합니다. **Apply and verify** 를 누르거나 ⌘/Ctrl + Enter를 누릅니다. `{원본이름}.redacted.docx` 로 마스킹된 결과물이 다운로드됩니다.

후보 검토 방식, 단축키, 문제 해결, 계약서가 아닌 문서(의견서, 준비서면, 메모 등)에서의 사용법까지 다룬 자세한 가이드는 **[USAGE.md](USAGE.md)** (영문) 를 참고하세요.

─────────────────────────────────────────────────────────────

## 작동 방식 (간단히)

```mermaid
flowchart LR
    subgraph browser["당신의 브라우저 탭 &mdash; 오프라인, 네트워크 없음"]
        direction LR
        A([.docx 드롭]) --> B[파싱<br/>JSZip + 원시 XML]
        B --> C[감지<br/>PII 정규식<br/>+ 입력한 시드]
        C --> D[/검토<br/>후보 토글/]
        D --> E[마스킹 + 검증<br/>run 간 재작성]
        E --> F([다운로드<br/>.redacted.docx<br/>+ SHA-256])
    end
```

둥근 모서리는 입/출력(파일 in, 파일 out)입니다. 사각형은 완전 자동화된 단계입니다. 평행사변형은 사람이 개입하는 유일한 지점입니다 — 감지된 후보를 검토하고 어떤 것을 마스킹할지 직접 토글하는 곳입니다. **서브그래프 안쪽 전체가 당신의 브라우저 탭 안에서만 실행됩니다.** 네트워크 호출 없음, 서버 왕복 없음, 백그라운드 워커 없음. 도구는 `.docx` 를 zip으로 로드하고(Word 파일은 XML들의 zip입니다), 텍스트가 들어있는 모든 scope(본문, 각주, 미주, 댓글, 머리말, 바닥글)를 순회하면서 정규식과 당신의 시드로 후보를 감지합니다. 그다음 당신의 검토 결과에 따라 XML을 제자리에서 재작성하고, 바이트 단위로 재현 가능한 결과물과 그에 매칭되는 SHA-256 해시를 생성합니다.

단계별 가이드는 [USAGE.md](USAGE.md) (영문) 를 참고하세요.

─────────────────────────────────────────────────────────────

## 왜 하나의 HTML 파일인가

2026년에 단일 HTML 파일로 도구를 배포한다는 건 흔치 않은 선택입니다. 대부분의 도구는 웹앱, 데스크톱 앱, CLI 중 하나로 출시됩니다. 파일 기반 배포를 선택한 이유는 다음과 같습니다:

1. **구조적으로 오프라인.** 연결할 대상 자체가 없습니다. 파일이 로드되는 순간 도구는 이미 완성 상태입니다. 지연 로드되는 chunk도, CDN도, 폰트 서버도 없습니다. 마스킹 작업 중에 WiFi가 끊겨도 아무것도 달라지지 않습니다.

2. **한 번의 읽기로 감사 가능.** 프로그램 전체가 약 5,000줄의 생성된 JavaScript와 CSS가 파일 하나에 담긴 형태입니다. `cat`으로 출력하거나 `grep`으로 검색하거나, LLM에 통째로 붙여넣고 "여기에 네트워크로 나가는 코드 있어?"라고 물어볼 수도 있습니다. 답은 몇 분 안에 검증 가능합니다.

3. **인프라 없이 배포 가능.** 유지할 서버도, 갱신해야 할 도메인도, 지켜야 할 계정 DB도 없습니다. 이메일로 보내도 되고, USB에 담아서 건네도 되고, 카카오톡으로 공유해도 됩니다. 받는 사람은 `sha256sum` 한 줄로 무결성을 확인합니다.

4. **업데이트 경로 자체가 없음.** 이 도구는 스스로 업데이트할 수 없습니다. 악성 업데이트가 당신에게 도달할 경로가 없다는 뜻입니다. 다운로드한 그 버전이 당신이 실행하는 버전이고, 그게 영구적입니다. 새 버전이 나오면 받을지 말지는 당신이 선택합니다.

트레이드오프는 v1이 서버가 정말 필요한 기능들(팀 협업, 공유 감사 로그, 중앙 집중식 정책 관리)을 지원하지 않는다는 점입니다. 이건 의도적 선택입니다 — 단일 파일 모델은 제약이 아니라 제품의 본질입니다.

─────────────────────────────────────────────────────────────

## 신뢰의 구조 — "네트워크 없음"의 4단 방어

이 도구가 당신의 문서를 들고 몰래 외부로 통신할 수 없어야 한다 — 이것이 약속입니다. 이 약속은 서로 독립적인 네 개의 층위에서 강제됩니다:

| 층위 | 메커니즘 | 검증 방법 |
|---|---|---|
| **소스 코드** | ESLint 룰 `no-restricted-syntax` 가 매 커밋마다 `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, 동적 `import()` 의 사용 자체를 금지 | 소스 체크아웃 후 `bun run lint` 실행 |
| **번들** | `vite.config.ts` 가 modulepreload 폴리필을 비활성화합니다 (이 폴리필은 동적 chunk 프리로드를 위해 `fetch()` 호출을 주입). 빌드 시점 ship-gate 테스트는 출력 HTML에 `fetch(` 토큰 0개, `XMLHttpRequest` 0개, `new WebSocket` 0개임을 실제 문자열 검색으로 확인 | `grep -c 'fetch(' document-redactor.html` → `0` |
| **런타임** | HTML에 내장된 Content-Security-Policy 메타 태그: `default-src 'none'; connect-src 'none'; ...`. 실행 중인 페이지가 소켓을 열려고 시도하는 순간 브라우저가 탭을 빠져나가기 전에 차단 | 개발자 도구 → Network 탭 열고 → 도구 사용해보기 → 요청 0건인지 확인 |
| **배포** | 모든 릴리즈에 SHA-256 사이드카가 동봉됨. 당신이 다운로드한 도구의 해시는 CI 파이프라인이 해당 태그 커밋에서 빌드한 결과물의 해시와 일치. 커밋 히스토리, 변경 diff, 빌드 로그 전부 GitHub에서 공개 | `sha256sum -c document-redactor.html.sha256` |

각 층위는 독립적입니다. 하나를 뚫어도 나머지 셋이 남아있습니다. 이건 "보안 쇼(security theater)"가 아닙니다 — 코드 레벨의 금지가 도구가 약속대로 동작하게 만드는 실질적 기반이고, CSP는 이론적인 번들 레벨 우회를 차단하는 장치이며, 해시는 배포 과정에서의 중간자 공격(man-in-the-middle)을 방지합니다.

─────────────────────────────────────────────────────────────

## 기술 스택

| 층위 | 선택 | 이유 |
|---|---|---|
| 패키지 매니저 | **Bun 1.x** | 빠른 설치, TypeScript 기본 지원, 추가 도구체인 불필요 |
| 번들러 | **Vite 8** | 현대적 DX, ES 모듈 1급 지원, 단단한 플러그인 생태계 |
| UI 프레임워크 | **Svelte 5** (runes 모드) | 가장 작은 런타임 footprint, 세밀한 반응성, 약 30 KB 오버헤드 |
| 단일 파일 패키징 | **vite-plugin-singlefile** | 모든 JS chunk와 CSS 시트를 HTML에 인라인 |
| DOCX 파싱 + 수정 | **JSZip** + 원시 XML 조작 | 쓰기 전용 라이브러리 사용 안 함 (`docx.js` 는 Gate 0 단계에서 읽기 지원이 없어 탈락) |
| Run 간 텍스트 처리 | 자체 **coalescer** 모듈 | Word는 `<w:t>ABC Corpo</w:t><w:t>ration</w:t>` 처럼 run을 분할합니다. coalescer가 논리적 텍스트 뷰를 재조립하고 매칭을 찾은 뒤, 영향받는 run만 수술적으로 재작성합니다 |
| 해싱 | **Web Crypto SubtleCrypto**(브라우저) + **node:crypto**(빌드) | 플랫폼 프리미티브, 외부 의존성 없음 |
| 테스트 | **Vitest 2** | Vite 네이티브, 빠름, TypeScript 우선. 422 테스트가 약 1.5초 |
| 타입 체크 | **TypeScript 5 strict** + **svelte-check 4** | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` 전부 활성 |
| 린팅 | **ESLint 9** (flat config) | 커스텀 `no-restricted-syntax` 룰이 소스 레벨에서 "네트워크 없음" 불변식을 강제 |
| CI | **GitHub Actions**, `ubuntu-latest`, Bun | 공개 레포는 무료, 실행당 약 40초 |

**의도적으로 뺀 것들:** React 없음, 웹 프레임워크 없음, CSS-in-JS 런타임 없음, 상태 관리 라이브러리 없음, 날짜 처리 라이브러리 없음, i18n 프레임워크 없음, 애널리틱스 없음, 에러 리포팅 없음, 텔레메트리 없음, 기능 플래그 없음, A/B 테스트 없음, 네트워크로 나가는 lock-file 체크 없음.

─────────────────────────────────────────────────────────────

## 알려진 제한사항

이것들은 버그가 아닙니다 — v1에서 의도적으로 다루지 않은 것들입니다. 대부분 v1.x에서 계획되어 있습니다.

- **Level picker는 v1에서 장식용입니다.** **Standard** 룰 세트만 실제로 동작합니다. Conservative와 Paranoid 옵션은 UI 스텁이며, v1.1에서 구현 예정입니다.
- **문서 프리뷰에서 클릭-선택 불가.** 프리뷰 패널은 "후보 검토는 오른쪽 패널에서 진행"이라고 안내하는 자리표시자입니다. 완전한 WordprocessingML → HTML 렌더러는 별도 모듈 규모 작업이라 v1.1 또는 v1.2에서 다룰 예정입니다.
- **View source + Audit log 버튼은 비활성 상태입니다.** 각 버튼에 툴팁이 달려있습니다. v1.1 예정(self-hash 모달이 실행 중인 파일을 공개된 릴리즈 해시와 비교하게 됩니다).
- **720 px 미만에서는 2컬럼으로 축소됩니다.** 3컬럼 데스크톱 레이아웃을 편하게 쓰려면 ≥1024 px가 필요합니다.
- **OCR 없음.** DOCX 안에 텍스트가 이미지로 들어가 있으면(스캔 PDF를 Word로 가져온 경우 등) 그 이미지 속 텍스트는 처리되지 않습니다. 도구는 텍스트 run을 다루지, 픽셀을 다루지 않습니다.
- **임베디드 객체 내부는 순회하지 않음.** OLE로 임베디드된 Excel/PowerPoint 객체 안으로는 들어가지 않습니다. 네이티브 DOCX 표의 셀은 **정상적으로 처리됩니다**.
- **SmartArt, WordArt 텍스트는 처리하지 않음.** 이것들은 v1 범위 밖의 특수 OOXML 구조입니다.
- **주로 이중언어 계약서로 테스트됨.** 엔진은 텍스트 기반이라 어떤 DOCX에도 동작하지만, v1의 fixture corpus는 계약서 중심입니다. 의견서, 준비서면, 메모, 내부 노트 모두 실전에서 잘 동작합니다 — 사용 가이드는 [USAGE.md](USAGE.md#non-contract-documents) (영문) 를 참고하세요.

─────────────────────────────────────────────────────────────

## 개발자를 위한 정보

```bash
git clone https://github.com/lowtidebuild/document-redactor.git
cd document-redactor
bun install
bun run dev         # Vite 개발 서버, 127.0.0.1:5173
bun run test        # 422 tests, 약 1.5초
bun run typecheck   # tsc --noEmit + svelte-check
bun run lint        # ESLint ("네트워크 없음" 불변식 강제)
bun run build       # dist/document-redactor.html + .sha256 생성
```

테스트 스위트는 ship-gate 체크의 일부로 실제 `vite build`를 실행합니다. 그래서 `bun run test` 하나가 엔진, UI 로직, 프로덕션 빌드를 전부 end-to-end로 검증하는 가장 포괄적인 단일 명령입니다.

소스 레이아웃:

```
src/
├── detection/      PII 정규식 스윕 + 키워드 제안기
├── docx/           DOCX I/O: coalescer, scope walker, redactor, verifier
├── finalize/       SHA-256 + 단어 수 정합성 + ship-gate 오케스트레이터
├── propagation/    변형 전파 + 정의된 용어(defined term) 분류기
└── ui/             Svelte 5 컴포넌트 + 상태 머신 + 엔진 래퍼
```

─────────────────────────────────────────────────────────────

## 영감

[Tan Sze Yao의 Offline-Redactor](https://thegreatsze.github.io/Offline-Redactor/) 에서 영감을 받았습니다.

─────────────────────────────────────────────────────────────

## 라이선스

[Apache License 2.0](LICENSE). 사용, 수정, 재배포, 판매 모두 가능합니다 — LICENSE 파일의 조건(특허 허여 포함, 저작권·귀속 고지 유지 의무 포함)을 따라야 합니다.

─────────────────────────────────────────────────────────────

_[@lowtidebuild](https://github.com/lowtidebuild) 이 만들었습니다._
