package com.ilmservice.personalbudget.data;

import java.util.List;
import java.util.stream.Stream;

import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;

public interface ITransactionCategoryStore {

	TransactionCategory put(TransactionCategory.Builder builder);
	
	TransactionCategory get(int id);
	
	List<TransactionCategory> getAll();

}
