const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { JSDOM } = require("jsdom");

const { extractVisibleJobs } = require("../src/job-extractor.cjs");

const fixture = readFileSync(join(__dirname, "fixtures", "boss-job-list.html"), "utf8");

test("replays a sanitized BOSS job list fixture into normalized jobs", () => {
  const sourcePage = "https://www.zhipin.com/web/geek/jobs";
  const dom = new JSDOM(fixture, { url: sourcePage });

  const jobs = extractVisibleJobs(dom.window.document, sourcePage);

  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map(({ title, company, city, salary, hrName, hrActiveText, detailUrl, sourcePage: page }) => ({
      title,
      company,
      city,
      salary,
      hrName,
      hrActiveText,
      detailUrl,
      sourcePage: page
    })),
    [
      {
        title: "AI产品经理实习生",
        company: "示例智能科技",
        city: "北京",
        salary: "150-220元/天",
        hrName: "李经理",
        hrActiveText: "刚刚活跃",
        detailUrl: "https://www.zhipin.com/job_detail/demo-ai-pm.html",
        sourcePage
      },
      {
        title: "数据分析实习生",
        company: "示例数据咨询",
        city: "上海",
        salary: "8-12K",
        hrName: "王HR",
        hrActiveText: "今日活跃",
        detailUrl: "https://www.zhipin.com/job_detail/demo-data.html",
        sourcePage
      }
    ]
  );
  assert.match(jobs[0].collectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(jobs[0].id, /^boss-\d+$/);
});

test("deduplicates repeated links for the same job", () => {
  const dom = new JSDOM(`
    <div>
      <a href="/job_detail/repeated.html">数据分析实习生</a>
      <a href="/job_detail/repeated.html">数据分析实习生</a>
    </div>
  `, { url: "https://www.zhipin.com/web/geek/jobs" });

  const jobs = extractVisibleJobs(dom.window.document, "https://www.zhipin.com/web/geek/jobs");

  assert.equal(jobs.length, 1);
});
