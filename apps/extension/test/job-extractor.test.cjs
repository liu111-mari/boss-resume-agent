const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { JSDOM } = require("jsdom");

const { decodeBossText, extractVisibleJobs } = require("../src/job-extractor.cjs");

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

test("decodes BOSS private-use salary digits before matching", () => {
  assert.equal(decodeBossText("\uE034\uE031\uE031-\uE035\uE031\uE031元/天"), "300-400元/天");

  const dom = new JSDOM(`
    <article class="job-card-demo">
      <a href="/job_detail/encoded.html">AI产品实习生</a>
      <span>\uE034\uE031\uE031-\uE035\uE031\uE031元/天</span>
      <a href="/gongsi/demo.html">示例科技</a>
      <span>北京</span>
    </article>
  `, { url: "https://www.zhipin.com/web/geek/jobs" });

  assert.equal(extractVisibleJobs(dom.window.document, dom.window.location.href)[0].salary, "300-400元/天");
});

test("extracts the current detail page as one full-JD enrichment record", () => {
  const dom = new JSDOM(`
    <main>
      <section class="job-primary">
        <div class="name"><h1>AI产品实习生</h1><span class="salary">300-400元/天</span></div>
        <a class="text-desc text-city">北京</a>
        <span class="text-desc text-experiece">4天/周 6个月</span>
        <span class="text-desc text-degree">本科</span>
      </section>
      <aside><a href="/gongsi/demo-company.html">小米</a></aside>
      <section class="job-detail-section"><div class="job-sec-text">负责AI产品调研、需求分析、原型验证和完整前后端Demo开发。</div></section>
      <a href="/job_detail/related.html">相关岗位</a>
    </main>
  `, { url: "https://www.zhipin.com/job_detail/current.html" });

  const jobs = extractVisibleJobs(dom.window.document, dom.window.location.href);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "AI产品实习生");
  assert.equal(jobs[0].company, "小米");
  assert.equal(jobs[0].salary, "300-400元/天");
  assert.equal(jobs[0].jdText, "负责AI产品调研、需求分析、原型验证和完整前后端Demo开发。");
  assert.equal(jobs[0].jdSource, "detail");
  assert.equal(jobs[0].detailUrl, "https://www.zhipin.com/job_detail/current.html");
});
