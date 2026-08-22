update employees
set payment_method = 'cash'
where payment_method is null;

alter table employees
alter column payment_method set default 'cash';
