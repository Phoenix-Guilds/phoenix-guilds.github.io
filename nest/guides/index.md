---
layout: nest-default
title: Гайды Phoenix
---

# Библиотека знаний

{% for guide in site.guides %}
  ### [{{ guide.title }}]({{ guide.url }})
  *Автор: {{ guide.author }}*
{% endfor %}

---
[Вернуться на главную](/nest/)