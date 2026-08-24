<!--
  What you write here becomes the commit message on main, verbatim: the merge is
  squashed, and it takes its subject from the title above and its body from this
  field. So this is not a note to a reviewer — it is the history.

  Write the subject in the imperative, saying what the change does. Then say why
  it was needed and what goes wrong without it. Delete these lines before
  merging; they land in `git log` too.

  Before opening: `npm run check`. A behaviour change also needs the acceptance
  suite against a real deployment — see CONTRIBUTING.md.

  这里写的内容会原样成为 main 上的提交信息：合并是 squash 的，标题取自上面那一行，
  正文取自这个字段。所以它不是给评审看完就消失的便条，它就是历史本身。

  主题行用祈使句说这个改动做了什么，正文说为什么需要它、没有它会出什么问题。合并前
  把这几行注释删掉，它们同样会进 `git log`。

  开 PR 前先跑 `npm run check`。行为上的改动还需要针对真实部署跑验收套件，见
  CONTRIBUTING.zh.md。
-->
