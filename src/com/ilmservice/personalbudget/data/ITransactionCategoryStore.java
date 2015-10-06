package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Stream;

import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;

public interface ITransactionCategoryStore {

	TransactionCategory put(TransactionCategory.Builder builder) throws IOException, Exception;
	
	TransactionCategory get(int id) throws IOException;
	
	<R> R withStream(Function<Stream<TransactionCategory>, R> action);

}
