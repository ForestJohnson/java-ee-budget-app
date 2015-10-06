package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Stream;

import javax.annotation.PostConstruct;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;
import com.ilmservice.repository.TransactionPerRequest;

@Default
@Singleton
public class TransactionCategoryStore implements ITransactionCategoryStore {
	
	@Inject 
	@TransactionPerRequest
	private IDbScope scope;
	
	@Inject 
	private IRepository<TransactionCategory> categories;
	
	private IRepositoryIndex<Integer, TransactionCategory> categoriesById;
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionCategoryStore configuring");
		categories.configure( 
			scope,
			(bytes) -> TransactionCategory.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionCategoryStore indexes ");

					categoriesById = categories.configureIndex(
						Indexes.TransactionCategoriesById.getValue(),
						false,
						(k) -> TransactionCategory.getDefaultInstance(),
						(v) -> v.getId(),
						(k) -> ByteBuffer.allocate(4).putInt(k).array()
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public TransactionCategory put(TransactionCategory.Builder builder) throws IOException, Exception {
		Optional<TransactionCategory> highestCategory = 
				categoriesById.query().descending()
				.withStream((s) -> s.findFirst() );
		
		int highestId = highestCategory.isPresent() ? highestCategory.get().getId() : 0;
		
		builder.setId(highestId+1);
		return categories.put(builder.build());
	}
	
	@Override
	public TransactionCategory get (int id) throws IOException {
		return categoriesById.get(id).get();
	}
	
	@Override
	public <R> R withStream(Function<Stream<TransactionCategory>, R> action) {
		return categoriesById.query().withStream(action);
	}
}
