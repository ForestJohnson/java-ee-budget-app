package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import com.ilmservice.personalbudget.protobufs.Data.CategoryKeyword;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;

public interface ICategorySuggestionStore {

	void put(Transaction toIndex) throws IOException;
	
	Map<Integer, Float> suggest(Transaction toSuggest) throws IOException;
}
