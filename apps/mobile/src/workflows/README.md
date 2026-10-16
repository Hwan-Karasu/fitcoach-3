# Cross-module workflows

Calendar↔Accounting, структурная правка Plans↔Execution, архив/удаление и
импорт координируются здесь как явные application use cases. Общий transaction
scope и post-commit effects определяются при реализации; отдельных скрытых
commit в соседних фичах быть не должно.
