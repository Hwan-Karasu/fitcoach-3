# Navigation separation audit

18 base combinations + 72 week contexts. Six contrast pairs per state (540 total). Decorative border target 1.5:1 on each side is a visual separation criterion, not a WCAG control-boundary claim. Text 4.5:1, inactive icons 3:1. Disabled opacity and native pressed states need Android inspection.

Navigation uses the theme input surface; the supplied JSON remains unchanged. The outline is corrected toward iconSecondary only as far as needed.

| State | Bar | Outline | Border/page · border/bar · label · icon · accent · selected |
|---|---|---|---|
| warm-sand / caramel | #F1E8DD | #cbbeb0 | 1.62 / 1.50 / 5.89 / 4.70 / 5.43 / 4.69 |
| warm-sand / caramel / week:success | #e3e0d3 | #a2b39c | 1.82 / 1.68 / 5.39 / 4.30 / 4.54 / 4.92 |
| warm-sand / caramel / week:warning | #e9dece | #c3ab87 | 1.82 / 1.66 / 5.37 / 4.29 / 4.61 / 5.02 |
| warm-sand / caramel / week:danger | #ebdcd1 | #cda196 | 1.88 / 1.72 / 5.33 / 4.26 / 4.82 / 5.21 |
| warm-sand / caramel / week:blue | #e3deda | #a2aac0 | 1.90 / 1.74 / 5.34 / 4.27 / 5.14 / 5.54 |
| warm-sand / chocolate | #F1E8DD | #cbbeb0 | 1.62 / 1.50 / 5.89 / 4.70 / 5.80 / 5.14 |
| warm-sand / chocolate / week:success | #e3e0d3 | #a2b39c | 1.82 / 1.68 / 5.39 / 4.30 / 4.54 / 4.92 |
| warm-sand / chocolate / week:warning | #e9dece | #c3ab87 | 1.82 / 1.66 / 5.37 / 4.29 / 4.61 / 5.02 |
| warm-sand / chocolate / week:danger | #ebdcd1 | #cda196 | 1.88 / 1.72 / 5.33 / 4.26 / 4.82 / 5.21 |
| warm-sand / chocolate / week:blue | #e3deda | #a2aac0 | 1.90 / 1.74 / 5.34 / 4.27 / 5.14 / 5.54 |
| warm-sand / golden-sand | #F1E8DD | #cbbeb0 | 1.62 / 1.50 / 5.89 / 4.70 / 5.37 / 4.68 |
| warm-sand / golden-sand / week:success | #e3e0d3 | #a2b39c | 1.82 / 1.68 / 5.39 / 4.30 / 4.54 / 4.92 |
| warm-sand / golden-sand / week:warning | #e9dece | #c3ab87 | 1.82 / 1.66 / 5.37 / 4.29 / 4.61 / 5.02 |
| warm-sand / golden-sand / week:danger | #ebdcd1 | #cda196 | 1.88 / 1.72 / 5.33 / 4.26 / 4.82 / 5.21 |
| warm-sand / golden-sand / week:blue | #e3deda | #a2aac0 | 1.90 / 1.74 / 5.34 / 4.27 / 5.14 / 5.54 |
| sage-milk / sage | #E8EFE4 | #b9c6b7 | 1.63 / 1.51 / 5.45 / 4.28 / 5.43 / 4.82 |
| sage-milk / sage / week:success | #dbe6d9 | #9bbca4 | 1.76 / 1.61 / 4.97 / 3.91 / 4.61 / 4.86 |
| sage-milk / sage / week:warning | #e1e5d5 | #bcb48f | 1.77 / 1.63 / 4.99 / 3.92 / 4.77 / 5.02 |
| sage-milk / sage / week:danger | #e3e3d8 | #c6aa9e | 1.83 / 1.68 / 4.95 / 3.89 / 4.99 / 5.21 |
| sage-milk / sage / week:blue | #dae4e0 | #9ab3c8 | 1.82 / 1.67 / 4.92 / 3.87 / 5.28 / 5.54 |
| sage-milk / olive | #E8EFE4 | #b9c6b7 | 1.63 / 1.51 / 5.45 / 4.28 / 5.37 / 4.57 |
| sage-milk / olive / week:success | #dbe6d9 | #9bbca4 | 1.76 / 1.61 / 4.97 / 3.91 / 4.61 / 4.86 |
| sage-milk / olive / week:warning | #e1e5d5 | #bcb48f | 1.77 / 1.63 / 4.99 / 3.92 / 4.77 / 5.02 |
| sage-milk / olive / week:danger | #e3e3d8 | #c6aa9e | 1.83 / 1.68 / 4.95 / 3.89 / 4.99 / 5.21 |
| sage-milk / olive / week:blue | #dae4e0 | #9ab3c8 | 1.82 / 1.67 / 4.92 / 3.87 / 5.28 / 5.54 |
| sage-milk / pine | #E8EFE4 | #b9c6b7 | 1.63 / 1.51 / 5.45 / 4.28 / 5.43 / 4.59 |
| sage-milk / pine / week:success | #dbe6d9 | #9bbca4 | 1.76 / 1.61 / 4.97 / 3.91 / 4.61 / 4.86 |
| sage-milk / pine / week:warning | #e1e5d5 | #bcb48f | 1.77 / 1.63 / 4.99 / 3.92 / 4.77 / 5.02 |
| sage-milk / pine / week:danger | #e3e3d8 | #c6aa9e | 1.83 / 1.68 / 4.95 / 3.89 / 4.99 / 5.21 |
| sage-milk / pine / week:blue | #dae4e0 | #9ab3c8 | 1.82 / 1.67 / 4.92 / 3.87 / 5.28 / 5.54 |
| slate-blue / steel-blue | #E5EEF8 | #b7c4d3 | 1.62 / 1.51 / 5.57 / 3.71 / 5.44 / 4.73 |
| slate-blue / steel-blue / week:success | #d8e5ec | #9abbb4 | 1.74 / 1.61 / 5.08 / 3.38 / 4.61 / 4.86 |
| slate-blue / steel-blue / week:warning | #dee4e7 | #bbb3a0 | 1.76 / 1.62 / 5.08 / 3.39 / 4.77 / 5.02 |
| slate-blue / steel-blue / week:danger | #e0e2ea | #c5a9ae | 1.82 / 1.68 / 5.05 / 3.36 / 4.98 / 5.21 |
| slate-blue / steel-blue / week:blue | #d8e3f3 | #9ab2d8 | 1.81 / 1.66 / 5.04 / 3.35 / 5.30 / 5.54 |
| slate-blue / cobalt | #E5EEF8 | #b7c4d3 | 1.62 / 1.51 / 5.57 / 3.71 / 5.73 / 5.01 |
| slate-blue / cobalt / week:success | #d8e5ec | #9abbb4 | 1.74 / 1.61 / 5.08 / 3.38 / 4.61 / 4.86 |
| slate-blue / cobalt / week:warning | #dee4e7 | #bbb3a0 | 1.76 / 1.62 / 5.08 / 3.39 / 4.77 / 5.02 |
| slate-blue / cobalt / week:danger | #e0e2ea | #c5a9ae | 1.82 / 1.68 / 5.05 / 3.36 / 4.98 / 5.21 |
| slate-blue / cobalt / week:blue | #d8e3f3 | #9ab2d8 | 1.81 / 1.66 / 5.04 / 3.35 / 5.30 / 5.54 |
| slate-blue / teal | #E5EEF8 | #b7c4d3 | 1.62 / 1.51 / 5.57 / 3.71 / 5.48 / 4.65 |
| slate-blue / teal / week:success | #d8e5ec | #9abbb4 | 1.74 / 1.61 / 5.08 / 3.38 / 4.61 / 4.86 |
| slate-blue / teal / week:warning | #dee4e7 | #bbb3a0 | 1.76 / 1.62 / 5.08 / 3.39 / 4.77 / 5.02 |
| slate-blue / teal / week:danger | #e0e2ea | #c5a9ae | 1.82 / 1.68 / 5.05 / 3.36 / 4.98 / 5.21 |
| slate-blue / teal / week:blue | #d8e3f3 | #9ab2d8 | 1.81 / 1.66 / 5.04 / 3.35 / 5.30 / 5.54 |
| dusty-terracotta / terracotta | #F5E4DA | #d0baaf | 1.67 / 1.50 / 5.45 / 3.86 / 5.39 / 4.77 |
| dusty-terracotta / terracotta / week:success | #e7dcd0 | #a6b39c | 1.82 / 1.63 / 4.99 / 3.53 / 4.50 / 4.99 |
| dusty-terracotta / terracotta / week:warning | #eddacc | #c7aa88 | 1.83 / 1.63 / 4.97 / 3.52 / 4.52 / 5.02 |
| dusty-terracotta / terracotta / week:danger | #efd8cf | #d1a096 | 1.88 / 1.68 / 4.94 / 3.50 / 4.73 / 5.21 |
| dusty-terracotta / terracotta / week:blue | #e7dad7 | #a5aac0 | 1.90 / 1.69 / 4.94 / 3.50 / 5.04 / 5.54 |
| dusty-terracotta / coral | #F5E4DA | #d0baaf | 1.67 / 1.50 / 5.45 / 3.86 / 5.39 / 4.52 |
| dusty-terracotta / coral / week:success | #e7dcd0 | #a6b39c | 1.82 / 1.63 / 4.99 / 3.53 / 4.50 / 4.99 |
| dusty-terracotta / coral / week:warning | #eddacc | #c7aa88 | 1.83 / 1.63 / 4.97 / 3.52 / 4.52 / 5.02 |
| dusty-terracotta / coral / week:danger | #efd8cf | #d1a096 | 1.88 / 1.68 / 4.94 / 3.50 / 4.73 / 5.21 |
| dusty-terracotta / coral / week:blue | #e7dad7 | #a5aac0 | 1.90 / 1.69 / 4.94 / 3.50 / 5.04 / 5.54 |
| dusty-terracotta / copper | #F5E4DA | #d0baaf | 1.67 / 1.50 / 5.45 / 3.86 / 5.39 / 4.59 |
| dusty-terracotta / copper / week:success | #e7dcd0 | #a6b39c | 1.82 / 1.63 / 4.99 / 3.53 / 4.50 / 4.99 |
| dusty-terracotta / copper / week:warning | #eddacc | #c7aa88 | 1.83 / 1.63 / 4.97 / 3.52 / 4.52 / 5.02 |
| dusty-terracotta / copper / week:danger | #efd8cf | #d1a096 | 1.88 / 1.68 / 4.94 / 3.50 / 4.73 / 5.21 |
| dusty-terracotta / copper / week:blue | #e7dad7 | #a5aac0 | 1.90 / 1.69 / 4.94 / 3.50 / 5.04 / 5.54 |
| graphite-latte / mocha | #E7E2DC | #c1b9b0 | 1.72 / 1.51 / 5.36 / 3.82 / 5.33 / 4.73 |
| graphite-latte / mocha / week:success | #dadad2 | #9eb39f | 1.83 / 1.59 / 4.91 / 3.50 / 4.55 / 5.25 |
| graphite-latte / mocha / week:warning | #e0d8cd | #bfab8a | 1.83 / 1.58 / 4.88 / 3.48 / 4.50 / 5.21 |
| graphite-latte / mocha / week:danger | #e2d6d0 | #c9a199 | 1.89 / 1.63 / 4.85 / 3.45 / 4.53 / 5.21 |
| graphite-latte / mocha / week:blue | #d9d8d9 | #9eaac3 | 1.90 / 1.64 / 4.85 / 3.46 / 4.83 / 5.54 |
| graphite-latte / taupe | #E7E2DC | #c1b9b0 | 1.72 / 1.51 / 5.36 / 3.82 / 5.36 / 4.76 |
| graphite-latte / taupe / week:success | #dadad2 | #9eb39f | 1.83 / 1.59 / 4.91 / 3.50 / 4.55 / 5.25 |
| graphite-latte / taupe / week:warning | #e0d8cd | #bfab8a | 1.83 / 1.58 / 4.88 / 3.48 / 4.50 / 5.21 |
| graphite-latte / taupe / week:danger | #e2d6d0 | #c9a199 | 1.89 / 1.63 / 4.85 / 3.45 / 4.53 / 5.21 |
| graphite-latte / taupe / week:blue | #d9d8d9 | #9eaac3 | 1.90 / 1.64 / 4.85 / 3.46 / 4.83 / 5.54 |
| graphite-latte / bronze | #E7E2DC | #c1b9b0 | 1.72 / 1.51 / 5.36 / 3.82 / 5.36 / 4.69 |
| graphite-latte / bronze / week:success | #dadad2 | #9eb39f | 1.83 / 1.59 / 4.91 / 3.50 / 4.55 / 5.25 |
| graphite-latte / bronze / week:warning | #e0d8cd | #bfab8a | 1.83 / 1.58 / 4.88 / 3.48 / 4.50 / 5.21 |
| graphite-latte / bronze / week:danger | #e2d6d0 | #c9a199 | 1.89 / 1.63 / 4.85 / 3.45 / 4.53 / 5.21 |
| graphite-latte / bronze / week:blue | #d9d8d9 | #9eaac3 | 1.90 / 1.64 / 4.85 / 3.46 / 4.83 / 5.54 |
| night-mocha / amber | #342923 | #59483F | 2.04 / 1.63 / 7.95 / 7.27 / 7.53 / 7.63 |
| night-mocha / amber / week:success | #3a352d | #6c7867 | 3.42 / 2.62 / 6.85 / 6.26 / 6.84 / 6.49 |
| night-mocha / amber / week:warning | #413428 | #8e744e | 3.55 / 2.72 / 6.77 / 6.19 / 7.51 / 7.06 |
| night-mocha / amber / week:danger | #41312b | #8e665b | 3.20 / 2.47 / 6.96 / 6.37 / 5.82 / 5.64 |
| night-mocha / amber / week:blue | #3b3332 | #707182 | 3.31 / 2.56 / 6.93 / 6.34 / 6.48 / 6.16 |
| night-mocha / latte | #342923 | #59483F | 2.04 / 1.63 / 7.95 / 7.27 / 6.71 / 8.52 |
| night-mocha / latte / week:success | #3a352d | #6c7867 | 3.42 / 2.62 / 6.85 / 6.26 / 6.84 / 6.49 |
| night-mocha / latte / week:warning | #413428 | #8e744e | 3.55 / 2.72 / 6.77 / 6.19 / 7.51 / 7.06 |
| night-mocha / latte / week:danger | #41312b | #8e665b | 3.20 / 2.47 / 6.96 / 6.37 / 5.82 / 5.64 |
| night-mocha / latte / week:blue | #3b3332 | #707182 | 3.31 / 2.56 / 6.93 / 6.34 / 6.48 / 6.16 |
| night-mocha / lavender | #342923 | #59483F | 2.04 / 1.63 / 7.95 / 7.27 / 6.97 / 8.26 |
| night-mocha / lavender / week:success | #3a352d | #6c7867 | 3.42 / 2.62 / 6.85 / 6.26 / 6.84 / 6.49 |
| night-mocha / lavender / week:warning | #413428 | #8e744e | 3.55 / 2.72 / 6.77 / 6.19 / 7.51 / 7.06 |
| night-mocha / lavender / week:danger | #41312b | #8e665b | 3.20 / 2.47 / 6.96 / 6.37 / 5.82 / 5.64 |
| night-mocha / lavender / week:blue | #3b3332 | #707182 | 3.31 / 2.56 / 6.93 / 6.34 / 6.48 / 6.16 |

Failures: 0
