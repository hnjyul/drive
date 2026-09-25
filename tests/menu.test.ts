import worker, { parseMenuCsv, fetchMenuFromSheet, type MenuItem } from "../src/index";
import { createMockEnv } from "./mockEnv";

describe("parseMenuCsv", () => {
  it("헤더를 제외한 데이터 행을 파싱하고 순서 오름차순으로 정렬한다", () => {
    const csv = "메뉴명,경로,순서\n공지,/notice,2\n홈,/home,1";
    const items = parseMenuCsv(csv);
    expect(items).toEqual<MenuItem[]>([
      { name: "홈", path: "/home", order: 1 },
      { name: "공지", path: "/notice", order: 2 },
    ]);
  });

  it("헤더만 있고 데이터 행이 없으면 빈 배열을 반환한다", () => {
    expect(parseMenuCsv("메뉴명,경로,순서")).toEqual([]);
  });

  it("빈 문자열 입력에 대해 빈 배열을 반환한다", () => {
    expect(parseMenuCsv("")).toEqual([]);
  });

  it("컬럼 수가 3개 미만인 행은 무시한다", () => {
    const csv = "메뉴명,경로,순서\n홈,/home,1\n잘못된행,/broken";
    const items = parseMenuCsv(csv);
    expect(items).toEqual([{ name: "홈", path: "/home", order: 1 }]);
  });

  it("순서 컬럼이 숫자로 파싱되지 않는 행은 건너뛴다", () => {
    const csv = "메뉴명,경로,순서\n홈,/home,abc\n소개,/about,1";
    const items = parseMenuCsv(csv);
    expect(items).toEqual([{ name: "소개", path: "/about", order: 1 }]);
  });

  it("필드 내 이스케이프된 큰따옴표(\"\")를 하나의 큰따옴표로 복원한다", () => {
    const csv = '메뉴명,경로,순서\n"He said ""hi""","/home","1"';
    const items = parseMenuCsv(csv);
    expect(items).toEqual([{ name: 'He said "hi"', path: "/home", order: 1 }]);
  });

  it("구글 gviz 출력처럼 따옴표로 감싸지고 콤마가 포함된 필드를 처리한다", () => {
    const csv = '메뉴명,경로,순서\n"공지, 안내","/notice","2"\n"홈","/home","1"';
    const items = parseMenuCsv(csv);
    expect(items).toEqual([
      { name: "홈", path: "/home", order: 1 },
      { name: "공지, 안내", path: "/notice", order: 2 },
    ]);
  });
});

describe("fetchMenuFromSheet", () => {
  it("정상 CSV 응답을 파싱하여 반환한다", async () => {
    const csv = "메뉴명,경로,순서\n홈,/home,1";
    const fetchMock = jest.fn().mockResolvedValue(new Response(csv, { status: 200 }));
    const items = await fetchMenuFromSheet("drive-id", fetchMock as unknown as typeof fetch);
    expect(items).toEqual([{ name: "홈", path: "/home", order: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/drive-id/gviz/tq?tqx=out:csv",
    );
  });

  it("non-200 응답이면 빈 배열을 반환한다", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const items = await fetchMenuFromSheet("drive-id", fetchMock as unknown as typeof fetch);
    expect(items).toEqual([]);
  });

  it("네트워크 오류(reject) 시 예외를 던지지 않고 빈 배열을 반환한다", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("network down"));
    const items = await fetchMenuFromSheet("drive-id", fetchMock as unknown as typeof fetch);
    expect(items).toEqual([]);
  });
});

describe("fetch handler - GET /menu", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("드라이브 ID가 저장되어 있지 않으면 빈 배열을 반환한다", async () => {
    const res = await worker.fetch(new Request("http://localhost/menu"), createMockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([]);
  });

  it("드라이브 ID가 저장되어 있고 조회에 성공하면 정렬된 메뉴 배열을 반환한다", async () => {
    const env = createMockEnv({ driveId: "sheet-id" });
    const csv = "메뉴명,경로,순서\n공지,/notice,2\n홈,/home,1";
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(csv, { status: 200 })) as unknown as typeof fetch;

    const res = await worker.fetch(new Request("http://localhost/menu"), env);
    expect(await res.json()).toEqual([
      { name: "홈", path: "/home", order: 1 },
      { name: "공지", path: "/notice", order: 2 },
    ]);
  });

  it("시트 조회가 실패하면 빈 배열을 HTTP 200으로 반환한다", async () => {
    const env = createMockEnv({ driveId: "sheet-id" });
    global.fetch = jest.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;

    const res = await worker.fetch(new Request("http://localhost/menu"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
