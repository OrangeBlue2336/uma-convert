# AGENTS.md

이 문서는 이 저장소에서 작업하는 AI 에이전트(Claude, ChatGPT, Cursor, Copilot 등)를 위한 안내서입니다.
사람이 읽는 소개는 `Dev_README.md`를 먼저 보세요. 이 문서는 그보다 더 실무적인 규칙과, 코드를 왜 이렇게
짜 두었는지를 다룹니다.

## 이 프로젝트가 무엇인가

**UmaConvert**는 우마무스메 게임 폴더에서 꺼낸 파일을 브라우저 안에서 바로 변환하는 정적 웹사이트입니다.
GitHub Pages로 배포하며, 서버도 빌드 과정도 없습니다. 순수 HTML/CSS/JavaScript(ES 모듈)만 사용합니다.
개발자가 아닌 사람이 만들고 있으므로, 의존성을 늘리거나 빌드 도구(번들러, 트랜스파일러, 프레임워크)를
새로 들여오는 제안은 하지 마세요. 요청받지 않았다면 지금의 "파일 그대로 올리면 동작하는" 구조를 지키세요.

## 반드시 지킬 것

- **의존성 금지.** `npm install`이 필요한 것은 만들지 않습니다. `tests/convert-cli.mjs`는 예외로,
  이것도 Node.js 내장 기능만 씁니다.
- **`assets/js/core/`는 화면(DOM)을 몰라야 합니다.** 브라우저 전용 API(`document`, `window`, `canvas` 등)를
  이 폴더 안에 넣지 마세요. 그래야 `tests/convert-cli.mjs`처럼 Node.js에서도 그대로 돌릴 수 있고,
  화면 버그와 변환 버그를 구분해서 진단할 수 있습니다.
- **한국어 주석은 "왜"를 설명합니다.** 코드를 그대로 옮겨 적는 주석 대신, 왜 이렇게 짰는지(예: Unity가
  이미지를 아래쪽 줄부터 저장해서 뒤집는다, PNG를 canvas 대신 직접 만드는 이유 등)를 남기세요. 새 코드를
  추가할 때도 이 스타일을 따르세요.
- **핵심 로직을 건드리면 픽셀 단위로 재검증하세요.** 이 프로젝트는 "UABEA/UnityPy로 변환한 결과와 완전히
  같은 픽셀"이 핵심 가치입니다. `assets/js/core/decoders/`, `assets/js/core/texture.js`,
  `assets/js/core/sprites.js`, `assets/js/encode/png.js`를 고쳤다면, 최소한 다음을 확인하세요.
  1. `node tests/convert-cli.mjs <텍스처 파일> out`으로 오류 없이 끝까지 도는지
  2. 결과 PNG를 UABEA나 UnityPy(파이썬, `pip install UnityPy`) 같은 다른 도구의 결과와 픽셀 비교
     (파이썬 예시는 아래 "회귀 검증 방법" 참고)
  사용자가 테스트용 텍스처 파일 몇 개를 저장소 밖 어딘가에 가지고 있을 수 있으니, 없다면 요청하세요.
- **`core/usm.js`를 건드리면 청크 디먹싱과 복호화를 모두 재검증하세요.** `.usm` 청크를 그대로 이어
  붙인 결과가 CRID `@UTF` 표에 적힌 원본 filesize와 정확히 같아야 하고(`tests/usm-cli.mjs`로 확인),
  **이것만으로는 부족합니다** — XOR은 길이를 바꾸지 않으므로 filesize 일치는 청크 경계 파싱만
  검증할 뿐 복호화 내용까지 보장하지 않습니다. 영상은 파일 내부 이름에 `_no_encrypted` 표시가 있어도
  키 없이는 깨진다는 것이 실사용 테스트로 확인됐습니다. 그래서 지금은 파일 이름으로 자동판단하지 않고
  `convertUsm`이 기본으로 항상 키를 적용합니다. 오디오는 형식에 따라 정반대입니다 — HCA는 키를
  적용하면 무음이 되고, ADX는 반대로 키를 적용하지 않으면 디코더가 몇 프레임 만에 멈춥니다. 그래서
  오디오는 내용(헤더 시그니처)으로 형식을 먼저 판별하고(`detectAudioFormat`) ADX일 때만 키를
  적용합니다(`buildAudioTracks`). 오디오 형식을 나타내는 USM 내부 "audio_codec" 숫자 필드는
  게임/버전마다 뜻이 다른 것으로 보여 신뢰하지 않습니다. 복호화 결과를 눈으로 검증하려면
  `ffmpeg -i video.h264 -frames:v N -f null -` 로 디코드 오류(`Reference N >= 3` 등)가 없는지, ADX는
  `ffmpeg -i audio_N.adx x.wav && ffprobe -show_entries format=duration x.wav`로 길이가 원본과
  맞는지 확인하세요. 키 값(`DEFAULT_KEY_HI/LO`)과 상위/하위 32비트 순서는 사용자가 실사용 중인 값을
  그대로 넣어 둔 것입니다. 자세한 내용과 검증 이력은 파일 머리말 주석과 `plan.md`에 있습니다.
- **`wavFileName`(같은 파일)이 반환하는 이름에는 원본 오디오 확장자가 그대로 들어갑니다**
  (`audio_0.adx.wav`처럼, `audio_0.wav`가 아님). vgmstream-web 같은 브라우저 변환 사이트에
  `audio_0.adx`를 끌어다 놓으면 확장자를 지우지 않고 뒤에 `.wav`만 붙여서 내려주기 때문에, "다음 단계"
  카드가 안내하는 ffmpeg 합치기 명령도 이 이름과 맞아야 실제로 동작합니다. 이 함수를 고칠 일이 있으면
  이 동작(원본 확장자 유지)을 깨지 마세요.
- **파비콘·폰트·base.css 링크는 손으로 맞추지 말고 반드시 빌드로 반영하세요.** 이 세 가지는
  `_partials/head-common.html` 한 곳에서 관리되고, 각 페이지의 `<!-- BUILD:START head-common.html -->`
  ~ `<!-- BUILD:END -->` 사이에 `node build.mjs`가 채워 넣습니다. 이 블록 안을 직접 고치면 다음 빌드 때
  덮어써 사라지므로, 고칠 내용이 있으면 반드시 `_partials/head-common.html`을 고친 뒤 빌드를 실행하세요.
  새 변환기 페이지를 만들 때도 이 블록을 그대로 복사해 두면(내용은 비워둬도 됨) 빌드가 채워줍니다.
  자세한 동작은 `build.mjs` 파일 맨 위 주석을 참고하세요.
- **제목, 설명, breadcrumb, 본문처럼 페이지마다 다른 내용은 지금처럼 각 파일에 직접 적습니다.**
  빌드 대상이 아닙니다. 새 변환기 페이지를 만들 때 `sprite/index.html`을 복사해 시작하되, 이 부분만
  새 내용으로 바꾸세요.
- **텍스트를 바꿀 때 화면 3곳을 함께 확인하세요.** 같은 문구가 `index.html`/`sprite/index.html`(정적 텍스트),
  `assets/js/tools.js`(메인 타일 문구), `assets/js/sprite/main.js`나 `list.js`(동적으로 만드는 문구) 중
  여러 곳에 나뉘어 있을 수 있습니다.

## 디렉터리 구조와 각 폴더의 책임

```
index.html                 메인 페이지
sprite/index.html          스프라이트 변환기 페이지
lyrics/index.html          라이브 가사 변환기 페이지
usm/index.html              .usm 영상 데이터 변환기 페이지
favicon/                   파비콘 파일 일체 (realfavicongenerator.net 산출물이 들어갈 자리)
assets/
  css/
    base.css                 모든 페이지가 함께 쓰는 색·글꼴·버튼·머리말/꼬리말
    home.css                 메인 페이지 타일 전용
    converter.css            변환기 페이지 공통(탭, 드롭존, 결과 화면, 뷰어, 목록) — 새 변환기도 이걸 재사용
  img/                      파비콘이 아닌 그림 (타일 SVG/PNG 등)
  js/
    tools.js                 메인 페이지 타일 목록의 데이터. 새 변환기는 여기 한 항목만 추가하면 노출됨
    home.js                  tools.js를 읽어 타일 DOM을 그림
    core/                    파일 해석 + 복원. DOM 의존 금지 (위 규칙 참고)
      reader.js                바이트 읽기 도우미
      lz4.js                   LZ4 블록 압축 해제
      unityfs.js               UnityFS 번들 머리글 파싱, 내부 파일 추출
      serialized.js            SerializedFile(CAB-... 파일) 파싱, 오브젝트 목록
      typetree.js              타입트리 기반 필드 읽기 (Unity 버전이 달라도 동작하는 핵심)
      commonStrings.js         타입트리가 참조하는 공용 문자열 표 (생성 방법은 아래 참고)
      texture.js               Texture2D 오브젝트 -> RGBA 픽셀
      sprites.js               Sprite 오브젝트 -> 잘라낼 영역 목록, 실제 자르기
      convert.js               위 전부를 묶는 진입점 (convertBundle)
      decoders/                텍스처 형식별 디코더. 새 형식 추가는 여기 + index.js 한 줄
      lyrics.js                라이브 가사 에셋 파싱 -> 자막 형식 변환
      usm.js                   CRI USM 컨테이너 파싱 + 청크 복호화 + h264/hca 분리 (자세한 설계는 파일
                                머리말 주석과 저장소 최상위 `plan.md` 참고)
      errors.js                ConvertError: 사용자에게 그대로 보여줘도 되는 오류
    encode/
      png.js                   RGBA -> PNG. canvas를 쓰지 않는 이유는 파일 안 주석 참고
      zip.js                   여러 파일을 압축 없이 ZIP으로 묶기 (스프라이트 PNG, usm의 h264/hca 등 공용)
      crc32.js                 PNG/ZIP 공용
    sprite/                   스프라이트 페이지 전용 화면 코드 (다른 변환기는 건드리지 않음)
      main.js                   파일 열기~저장까지 전체 배선
      viewer.js                 이미지 위에 조각 영역을 겹쳐 그리는 뷰어
      list.js                   오른쪽 조각 목록 패널
    lyrics/main.js            라이브 가사 페이지 전용 화면 코드
    usm/main.js               .usm 페이지 전용 화면 코드 (파일 열기, 키 적용 토글, ZIP 저장,
                              결과에 맞춘 "다음 단계" 명령 렌더링)
    ui/                       여러 변환기 페이지가 함께 쓰는 화면 도우미
      tabs.js                   탭 전환
      download.js               파일 저장, 이름 정리
      clipboard.js              명령줄 복사 버튼 (usm의 "다음 단계" 카드가 씀)
tests/convert-cli.mjs      화면 없이 core+encode만 실행하는 명령줄 도구 (스프라이트, 회귀 확인용)
tests/usm-cli.mjs          화면 없이 core/usm.js만 실행하는 명령줄 도구
plan.md                    .usm 변환기 설계 조사 기록. 의존성 도입 여부(A/B/C안) 판단과 다음 단계(알파
                            합성 등)를 다룰 때 먼저 읽으세요.
```

## 새 변환기를 추가하는 절차

1. `assets/js/tools.js`의 배열에 항목을 추가합니다. 아직 안 만들었다면 `status: "soon"`.
2. `sprite/index.html`을 복사해 새 폴더(`lyrics/index.html` 등)를 만듭니다. 머리말(breadcrumb), 탭 구조,
   스타일시트 링크를 그대로 가져오고 상대 경로(`../`)만 확인하세요. `<!-- BUILD:START head-common.html -->`
   ~ `<!-- BUILD:END -->` 블록도 그대로 복사해 두면 됩니다(내용이 조금 안 맞아도 다음 빌드에서 고쳐집니다).
   폴더가 두 단계 이상 깊어지면(`assets/js/tools.js`와 무관하게 폴더만 깊어지는 경우) `build.mjs`가
   깊이를 자동으로 계산하므로 `{{ROOT}}` 관련 수정은 필요 없습니다.
3. 페이지 전용 화면 코드는 `assets/js/<변환기이름>/`에 새로 만듭니다. `sprite/main.js`가 좋은 본보기입니다.
   파일 파싱이 필요하면 `core/`를 재사용하고, 화면 전용 로직만 새로 짜세요.
4. 결과를 저장하는 기능이 필요하면 `assets/js/encode/`, `assets/js/ui/download.js`를 재사용하세요.
5. 변환기 페이지 전용 스타일이 많이 필요하면 `converter.css`에 추가하되, 다른 변환기도 쓰는 클래스
   이름(`.dropzone`, `.tab` 등)은 그대로 두고 새 클래스만 보태세요.
6. 커밋하기 전에 `node build.mjs`를 실행하세요. 새로 만든 페이지의 파비콘/폰트 블록을 채워주고,
   빠뜨린 페이지가 있으면 뭘 건드렸는지 알려줍니다.

## 새 텍스처 형식(디코더)을 추가하는 절차

1. `assets/js/core/decoders/`에 `(bytes, width, height) => RGBA Uint8Array`를 반환하는 함수를 만듭니다.
   `dxt.js`나 `raw.js`를 본보기로 삼으세요. 상하 반전은 `texture.js`의 `flipVertical`이 공통으로
   처리하므로 디코더는 Unity가 저장한 순서(아래쪽 줄부터) 그대로 돌려주면 됩니다.
2. `decoders/index.js`의 `FORMATS` 배열에 `{ id, name, decode, size }` 한 줄을 추가합니다. `id`는 Unity의
   `m_TextureFormat` 번호이고, `KNOWN_UNSUPPORTED`에 있었다면 그 줄을 지우세요.
3. 임의 바이트로 만든 테스트 벡터를 UnityPy(`from UnityPy.export.Texture2DConverter import parse_image_data`)
   같은 기존 도구로 돌려 기대값을 만들고, 새 디코더 결과와 바이트 단위로 비교하세요. 이 저장소를 만들 때도
   이 방식으로 11개 형식을 전부 검증했습니다.

## 타입트리 공용 문자열 표(`commonStrings.js`)가 뭔가요

Unity 타입트리는 `AABB`, `float`, `string` 같은 흔한 이름을 반복해서 저장하지 않고, 미리 정해진 표의
번호로 대신 가리킵니다. `commonStrings.js`는 그 표를 그대로 옮긴 것입니다. UnityPy 라이브러리 안의
`UnityPy.helpers.Tpk.get_common_strings()` 결과를 순서 그대로 문자열로 이어 붙여 만들었습니다. 이 표는
Unity 버전이 달라져도 앞부분은 바뀌지 않고 뒤에 추가만 되는 값이라, 당장은 다시 만들 필요가 거의 없습니다.
정말 새로 만들어야 한다면 위 함수 결과를 오프셋 순서대로 이어 붙이면 됩니다.

## 회귀 검증 방법 (핵심 로직을 고쳤을 때)

파이썬이 있는 환경이라면 아래로 기준값을 만들어 비교할 수 있습니다.

```python
import UnityPy
env = UnityPy.load("텍스처파일")
for o in env.objects:
    if o.type.name == "Texture2D":
        o.read().image.save("reference.png")
```

이렇게 만든 `reference.png`와 이 프로젝트로 만든 결과 PNG를 `numpy`로 픽셀 단위 비교(`(a != b).sum()`이
0인지)하면 됩니다. UABEA로 변환한 결과와 비교해도 됩니다. 둘 다 참고 도구일 뿐 정답은 아니지만, 이 값에서
벗어나면 대개는 이쪽 버그입니다.

## 자동 배포 (`.github/workflows/pages.yml`)

`main`에 푸시하면 GitHub Actions가 `node build.mjs`를 실행한 뒤 그 결과를 GitHub Pages로 바로
배포합니다. `GITHUB_TOKEN`으로 저장소에 다시 커밋하는 방식(흔히 보는 "빌드 결과를 gh-pages 브랜치에
커밋" 패턴)은 **일부러 쓰지 않았습니다** — GitHub 공식 문서에 따르면 그 토큰으로 푸시된 커밋은 Pages
재빌드를 트리거하지 않아서, 배포가 조용히 안 되는 함정이 있습니다. 대신 같은 실행 안에서 빌드와 배포를
모두 끝내는 `actions/upload-pages-artifact` + `actions/deploy-pages` 조합을 씁니다(둘 다 GitHub 공식
액션이며, 저장소 설정에서 Pages Source를 "GitHub Actions"로 지정해야 동작합니다). 이 워크플로 파일을
고칠 때는 이 배경을 참고해서, 별도 브랜치에 커밋하는 방식으로 되돌리지 마세요.

## 파비콘 (`favicon/` 폴더)

`favicon/`에는 realfavicongenerator.net에서 만든 파일들이 들어갑니다. 지금 들어 있는 파일은 임시로
`assets/img`에 있던 기존 SVG를 여러 크기로 늘려 만든 자리채움입니다. 이 폴더의 파일 이름
(`favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png`, `site.webmanifest`,
`web-app-manifest-192x192.png`, `web-app-manifest-512x512.png`)과 각 HTML의 `<head>` 5줄은
realfavicongenerator.net이 주는 표준 형식과 맞춰 두었습니다. 사용자가 그 사이트에서 새로 받은 파일로
이 폴더를 통째로 바꾸는 것을 전제로 하므로, 에이전트가 이 폴더의 내용을 생성 로직으로 다루지 마세요(즉
SVG에서 자동 생성하는 스크립트 같은 것을 파이프라인에 넣지 마세요). 사람이 직접 관리하는 자산입니다.

## 다국어(한국어/영어) 지원 — 아직 구현되어 있지 않음

이 저장소는 아직 한국어 전용입니다. 다국어를 구현해 달라는 요청을 받으면 `Dev_README.md`의 "다국어 지원"
절에 적어 둔 설계(폴더 구조를 바꾸지 않는 실행 시점 JSON 사전 교체 방식)를 따르세요. 코드 골격을 새로
설계하지 말고 그 절의 방식을 기본안으로 삼고, 사용자와 다른 방식을 논의한 이력이 있다면 그걸 우선하세요.

## 저작권/콘텐츠 관련 규칙

- 이 저장소에는 게임에서 추출한 원본 에셋 파일(텍스처, 사운드 등)을 절대 커밋하지 마세요. 테스트용
  파일은 저장소 밖(`/tmp`, 업로드 폴더 등)에 두고, `.gitignore`로 막혀 있는지 확인하세요.
- 메인 페이지 꼬리말의 "팬이 만든 비공식 도구" 문구와 원작 도구(UABEA, UmamusumeExplorer 등) 크레딧
  링크는 유지하세요.
